## Code like DHH (@dhh) · controllers that tell the story

Conventions used so consistently that a new file is predictable. Controllers fit on one screen: actions are a
few lines, all setup pushed into `before_action` filters with self-documenting names (`set_room`,
`ensure_can_administer`). Cross-cutting behavior is extracted into named concerns (`Authentication`,
`Authorization`), not sprinkled inline. The code reads like the product, top to bottom.

- [`messages_controller.rb`](https://github.com/basecamp/once-campfire/blob/8d3c2bbd2be070008a275330efbee1001fd202dc/app/controllers/messages_controller.rb) — a controller you can read in one screen; the actions tell the story.
- [`authentication.rb`](https://github.com/basecamp/once-campfire/blob/8d3c2bbd2be070008a275330efbee1001fd202dc/app/controllers/concerns/authentication.rb) — a named policy extracted as a concern, reused everywhere.
- [`message.rb`](https://github.com/basecamp/once-campfire/blob/8d3c2bbd2be070008a275330efbee1001fd202dc/app/models/message.rb) — a fat-but-organized model with the domain rules where they belong.
