## Code like DHH (@dhh) · controllers that tell the story

DHH writes code that reads like an outline of intent, not a transcript of implementation. Controllers are one-line-per-action tables of contents; the hard work lives in named model methods, scopes, and concerns that carry the domain vocabulary. Cross-cutting rules — auth, scoping, rate-limiting — are declared once in a concern and applied by name at the call site, never repeated inline. Error handling follows the same philosophy: domain errors become named exception classes, guard clauses become named predicates, and failure paths redirect or respond with a status, never swallow. Tests are integration-first, hitting real HTTP endpoints with fixture data and asserting on the full response, not on implementation details.

### `sessions_controller.rb` — the controller as a table of contents; no logic leaks in

[source](https://github.com/basecamp/once-campfire/blob/8d3c2bbd2be070008a275330efbee1001fd202dc/app/controllers/sessions_controller.rb)
```ruby
class SessionsController < ApplicationController
  allow_unauthenticated_access only: %i[ new create ]
  rate_limit to: 10, within: 3.minutes, only: :create, with: -> { render_rejection :too_many_requests }

  before_action :ensure_user_exists, only: :new

  def new
  end

  def create
    if user = User.active.authenticate_by(email_address: params[:email_address], password: params[:password])
      start_new_session_for user
      redirect_to post_authenticating_url
    else
      render_rejection :unauthorized
    end
  end

  def destroy
    remove_push_subscription
    terminate_current_session
    redirect_to root_url
  end

  private
    def ensure_user_exists
      redirect_to first_run_url if User.none?
    end

    def render_rejection(status)
      flash.now[:alert] = "Too many requests or unauthorized."
      render :new, status: status
    end

    def remove_push_subscription
      if endpoint = params[:push_subscription_endpoint]
        Push::Subscription.destroy_by(endpoint: endpoint, user_id: Current.user.id)
      end
    end
end
```
Every action is two lines or fewer; policy declarations (`allow_unauthenticated_access`, `rate_limit`) sit at the top of the class like annotations. The only conditional in `create` names both branches — `authenticate_by` and `render_rejection` — and neither branch has any implementation detail inside the action body.

### `room.rb` — association extensions as named domain operations, not ad-hoc query logic

[source](https://github.com/basecamp/once-campfire/blob/8d3c2bbd2be070008a275330efbee1001fd202dc/app/models/room.rb)
```ruby
class Room < ApplicationRecord
  has_many :memberships, dependent: :delete_all do
    def grant_to(users)
      room = proxy_association.owner
      Membership.insert_all(Array(users).collect { |user| { room_id: room.id, user_id: user.id, involvement: room.default_involvement } })
    end

    def revoke_from(users)
      destroy_by user: users
    end

    def revise(granted: [], revoked: [])
      transaction do
        grant_to(granted) if granted.present?
        revoke_from(revoked) if revoked.present?
      end
    end
  end

  has_many :users, through: :memberships
  has_many :messages, dependent: :destroy

  belongs_to :creator, class_name: "User", default: -> { Current.user }

  scope :opens,           -> { where(type: "Rooms::Open") }
  scope :closeds,         -> { where(type: "Rooms::Closed") }
  scope :directs,         -> { where(type: "Rooms::Direct") }
  scope :without_directs, -> { where.not(type: "Rooms::Direct") }
```
Membership management is embedded directly in the `has_many` block as named operations — `grant_to`, `revoke_from`, `revise` — so call sites say `room.memberships.grant_to(users)` and never need to know about `insert_all` or the involvement default. Scopes are aligned in columns so the type taxonomy reads as a visual table.

### `message/searchable.rb` — a concern that owns one responsibility end-to-end via lifecycle hooks

[source](https://github.com/basecamp/once-campfire/blob/8d3c2bbd2be070008a275330efbee1001fd202dc/app/models/message/searchable.rb)
```ruby
module Message::Searchable
  extend ActiveSupport::Concern

  included do
    after_create_commit  :create_in_index
    after_update_commit  :update_in_index
    after_destroy_commit :remove_from_index

    scope :search, ->(query) { joins("join message_search_index idx on messages.id = idx.rowid").where("idx.body match ?", query).ordered }
  end

  private
    def create_in_index
      execute_sql_with_binds "insert into message_search_index(rowid, body) values (?, ?)", id, plain_text_body
    end

    def update_in_index
      execute_sql_with_binds "update message_search_index set body = ? where rowid = ?", plain_text_body, id
    end

    def remove_from_index
      execute_sql_with_binds "delete from message_search_index where rowid = ?", id
    end

    def execute_sql_with_binds(*statement)
      self.class.connection.execute self.class.sanitize_sql(statement)
    end
end
```
The concern declares its full contract — create, update, destroy, and query — in one place. The lifecycle hook names (`create_in_index`, `update_in_index`, `remove_from_index`) match the SQL intent so closely that reading the `included` block gives you the full mental model without opening any private method.

### `opengraph/fetch.rb` — errors as named domain exception classes; validation decomposed into single-check predicates

[source](https://github.com/basecamp/once-campfire/blob/8d3c2bbd2be070008a275330efbee1001fd202dc/app/models/opengraph/fetch.rb)
```ruby
class Opengraph::Fetch
  ALLOWED_DOCUMENT_CONTENT_TYPE = "text/html"
  MAX_BODY_SIZE = 5.megabytes
  MAX_REDIRECTS = 10

  class TooManyRedirectsError < StandardError; end
  class RedirectDeniedError < StandardError; end

  def fetch_document(url, ip: RestrictedHTTP::PrivateNetworkGuard.resolve(url.host))
    request(url, Net::HTTP::Get, ip: ip) do |response|
      return body_if_acceptable(response)
    end
  end

  def fetch_content_type(url, ip: RestrictedHTTP::PrivateNetworkGuard.resolve(url.host))
    request(url, Net::HTTP::Head, ip: ip) do |response|
      return response["Content-Type"]
    end
  end

  private
    def request(url, request_class, ip:)
      MAX_REDIRECTS.times do
        Net::HTTP.start(url.host, url.port, ipaddr: ip, use_ssl: url.scheme == "https") do |http|
          http.request request_class.new(url) do |response|
            if response.is_a?(Net::HTTPRedirection)
              url, ip = resolve_redirect(response["location"])
            else
              yield response
            end
          end
        end
      end

      raise TooManyRedirectsError
    end

    def resolve_redirect(location)
      url = URI.parse(location)
      raise RedirectDeniedError unless url.is_a?(URI::HTTP)
      [ url, RestrictedHTTP::PrivateNetworkGuard.resolve(url.host) ]
    end

    def body_if_acceptable(response)
      size_restricted_body(response) if response_valid?(response)
    end

    def size_restricted_body(response)
      # We've already checked the Content-Length header, to try to avoid reading
      # the body of any large responses. But that header could be wrong or
      # missing. To be on the safe side, we'll read the body in chunks, and bail
      # if it runs over our size limit.
      StringIO.new.tap do |body|
        response.read_body do |chunk|
          return nil if body.string.bytesize + chunk.bytesize > MAX_BODY_SIZE
          body << chunk
        end
      end.string
    end

    def response_valid?(response)
      status_valid?(response) && content_type_valid?(response) && content_length_valid?(response)
    end
```
`TooManyRedirectsError` and `RedirectDeniedError` are named domain events, not rescued `StandardError`s. Validation is decomposed into three single-boolean predicates (`status_valid?`, `content_type_valid?`, `content_length_valid?`) composed by `response_valid?` — each validation predicate is exactly one line and one idea.

### `messages_controller_test.rb` — integration tests that hit the HTTP boundary with fixture identity, asserting on observable output

[source](https://github.com/basecamp/once-campfire/blob/8d3c2bbd2be070008a275330efbee1001fd202dc/test/controllers/messages_controller_test.rb)
```ruby
class MessagesControllerTest < ActionDispatch::IntegrationTest
  setup do
    host! "once.campfire.test"

    sign_in :david
    @room = rooms(:watercooler)
    @messages = @room.messages.ordered.to_a
  end

  test "index returns the last page by default" do
    get room_messages_url(@room)

    assert_response :success
    ensure_messages_present @messages.last
  end

  test "index returns a page before the specified message" do
    get room_messages_url(@room, before: @messages.third)

    assert_response :success
    ensure_messages_present @messages.first, @messages.second
    ensure_messages_not_present @messages.third, @messages.fourth, @messages.fifth
  end

  test "index returns a page after the specified message" do
    get room_messages_url(@room, after: @messages.third)

    assert_response :success
    ensure_messages_present @messages.fourth, @messages.fifth
    ensure_messages_not_present @messages.first, @messages.second, @messages.third
  end

  test "index returns no_content when there are no messages" do
    @room.messages.destroy_all

    get room_messages_url(@room)

    assert_response :no_content
  end

  test "get renders a single message belonging to the user" do
    message = @room.messages.where(creator: users(:david)).first

```
Tests are `ActionDispatch::IntegrationTest` — real HTTP, real fixture rows, real response assertions. Each test names one behavior in prose (`"ensure non-admin can't update a message belonging to another user"`), sets up identity with a fixture symbol (`sign_in :jz`), fires the endpoint, and asserts on the HTTP response or the rendered DOM. No mocks of the subject under test.

### `user/role.rb` — one-method concerns; `can_administer?` as a readable policy predicate

[source](https://github.com/basecamp/once-campfire/blob/8d3c2bbd2be070008a275330efbee1001fd202dc/app/models/user/role.rb)
```ruby
module User::Role
  extend ActiveSupport::Concern

  included do
    enum :role, %i[ member administrator bot ]
  end

  def can_administer?(record = nil)
    administrator? || self == record&.creator || record&.new_record?
  end
end
```
The entire authorization predicate for the application is one method, eleven words. `administrator?` comes from the enum; `self == record&.creator` is "you own it"; `record&.new_record?` is "it hasn't been saved yet." No boolean columns, no permission tables, no role-checking DSL — three `||`-joined clauses that any reader can audit in one glance.
