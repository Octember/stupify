## Code like David Tolnay (@dtolnay) · the API that disappears

Every public surface is the minimum needed for correct use. Errors carry full context but leak no internals. Macros generate exactly what you'd write by hand — no fingerprint. When stable Rust lacks a feature (specialization, thin pointers, backtrace capture), he simulates it with tagged dispatch, vtable construction, or `#[cold]` placement, always through a type-safe seam that vanishes at the call site.

### `kind.rs` — autoref dispatch as a substitute for specialization
[source](https://github.com/dtolnay/anyhow/blob/841522b2aa09732fecee40804440d2c35c68c480/src/kind.rs)
```rust
pub struct Adhoc;

#[doc(hidden)]
pub trait AdhocKind: Sized {
    #[inline]
    fn anyhow_kind(&self) -> Adhoc {
        Adhoc
    }
}

impl<T> AdhocKind for &T where T: ?Sized + Display + Debug + Send + Sync + 'static {}

impl Adhoc {
    #[cold]
    pub fn new<M>(self, message: M) -> Error
    where
        M: Display + Debug + Send + Sync + 'static,
    {
        Error::construct_from_adhoc(message, backtrace!())
    }
}

pub struct Trait;

#[doc(hidden)]
pub trait TraitKind: Sized {
    #[inline]
    fn anyhow_kind(&self) -> Trait {
        Trait
    }
}

impl<E> TraitKind for E where E: Into<Error> {}

impl Trait {
    #[cold]
    pub fn new<E>(self, error: E) -> Error
    where
        E: Into<Error>,
    {
        error.into()
    }
}
```
`AdhocKind` is implemented on `&T` (one extra autoref), so when `T: Into<Error>` the more-specific `TraitKind` impl on `T` wins method resolution without any `#[feature(specialization)]`. The entire dispatch is zero-cost: both paths are monomorphized and the `#[cold]` hint steers branch prediction. The macro call site is simply `(&error).anyhow_kind().new(error)` — the mechanism is invisible.

### `context.rs` — hidden `mod ext` unifies two error paths behind one trait
[source](https://github.com/dtolnay/anyhow/blob/841522b2aa09732fecee40804440d2c35c68c480/src/context.rs)
```rust
mod ext {
    use super::*;

    pub trait StdError {
        fn ext_context<C>(self, context: C) -> Error
        where
            C: Display + Send + Sync + 'static;
    }

    #[cfg(any(feature = "std", not(anyhow_no_core_error)))]
    impl<E> StdError for E
    where
        E: crate::StdError + Send + Sync + 'static,
    {
        fn ext_context<C>(self, context: C) -> Error
        where
            C: Display + Send + Sync + 'static,
        {
            let backtrace = backtrace_if_absent!(&self);
            Error::construct_from_context(context, self, backtrace)
        }
    }

    impl StdError for Error {
        fn ext_context<C>(self, context: C) -> Error
        where
            C: Display + Send + Sync + 'static,
        {
            self.context(context)
        }
    }
}

impl<T, E> Context<T, E> for Result<T, E>
where
    E: ext::StdError + Send + Sync + 'static,
{
    fn context<C>(self, context: C) -> Result<T, Error>
    where
        C: Display + Send + Sync + 'static,
    {
        // Not using map_err to save 2 useless frames off the captured backtrace
        // in ext_context.
        match self {
            Ok(ok) => Ok(ok),
            Err(error) => Err(error.ext_context(context)),
        }
    }

    fn with_context<C, F>(self, context: F) -> Result<T, Error>
    where
        C: Display + Send + Sync + 'static,
        F: FnOnce() -> C,
    {
        match self {
            Ok(ok) => Ok(ok),
            Err(error) => Err(error.ext_context(context())),
        }
    }
}
```
`mod ext` is private and its `StdError` shadow-trait is never exported. The two impls (one for any `E: std::error::Error`, one for `anyhow::Error` itself) unify behind `ext::StdError` so the public `Context` blanket impl handles both cases with a single where-clause. The comment "Not using map_err to save 2 useless frames" is characteristic: even incidental backtrace noise is deliberately cut.

### `expand.rs` — codegen that generates exactly the impl you'd write by hand
[source](https://github.com/dtolnay/thiserror/blob/7214e0e8331d76afbea7173d8a14997512ac8713/impl/src/expand.rs)
```rust
pub fn derive(input: &DeriveInput) -> TokenStream {
    match try_expand(input) {
        Ok(expanded) => expanded,
        // If there are invalid attributes in the input, expand to an Error impl
        // anyway to minimize spurious secondary errors in other code that uses
        // this type as an Error.
        Err(error) => fallback::expand(input, error),
    }
}

fn try_expand(input: &DeriveInput) -> Result<TokenStream> {
    let input = Input::from_syn(input)?;
    input.validate()?;
    Ok(match input {
        Input::Struct(input) => impl_struct(input),
        Input::Enum(input) => impl_enum(input),
    })
}

fn impl_struct(input: Struct) -> TokenStream {
    let ty = call_site_ident(&input.ident);
    let (impl_generics, ty_generics, where_clause) = input.generics.split_for_impl();
    let mut error_inferred_bounds = InferredBounds::new();

    let source_body = if let Some(transparent_attr) = &input.attrs.transparent {
        let only_field = &input.fields[0];
        if only_field.contains_generic {
            error_inferred_bounds.insert(only_field.ty, quote!(::thiserror::#private::Error));
        }
        let member = &only_field.member;
        Some(quote_spanned! {transparent_attr.span=>
            ::thiserror::#private::Error::source(self.#member.as_dyn_error())
        })
    } else if let Some(source_field) = input.source_field() {
        let source = &source_field.member;
        if source_field.contains_generic {
            let ty = unoptional_type(source_field.ty);
            error_inferred_bounds.insert(ty, quote!(::thiserror::#private::Error + 'static));
        }
        let asref = if type_is_option(source_field.ty) {
            Some(quote_spanned!(source.span()=> .as_ref()?))
        } else {
            None
        };
        let dyn_error = quote_spanned! {source_field.source_span()=>
            self.#source #asref.as_dyn_error()
        };
        Some(quote! {
            ::core::option::Option::Some(#dyn_error)
        })
    } else {
        None
    };
    let source_method = source_body.map(|body| {
        quote! {
            fn source(&self) -> ::core::option::Option<&(dyn ::thiserror::#private::Error + 'static)> {
                use ::thiserror::#private::AsDynError as _;
                #body
            }
        }
    });
```
`fallback::expand` ensures a broken `#[derive(Error)]` still emits a syntactically valid `Error` impl rather than flooding the user with secondary type errors — the macro recovers gracefully and reports exactly one error. The `source_body` computation mirrors the three cases (transparent, named source, absent) exactly as a hand-written `impl Error` would branch, then wraps the result in `Option` only when `source_body` is `Some` — no unconditional method emitted for types that have no source.
