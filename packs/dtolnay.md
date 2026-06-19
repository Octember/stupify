## Code like David Tolnay (@dtolnay) · the API that disappears

Every public surface is the minimum needed for correct use. Where Rust lacks specialization, thin pointers, or stable vtable dispatch, dtolnay simulates them through carefully typed seams — autoref dispatch, hand-rolled vtable structs, `repr(transparent)` newtype stacks — all of which vanish at the call site. Errors carry full context and backtrace, but expose no internals. Macros generate exactly the `impl` a skilled human would write by hand, including graceful fallback on parse failure. `#[cold]` appears on every error-path constructor so branch prediction never penalizes the happy path.

### `kind.rs` — autoref dispatch as a zero-cost substitute for specialization
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
`AdhocKind` is implemented on `&T` (one extra autoref), so when `T: Into<Error>` the more-specific `TraitKind` impl on `T` wins method resolution without any `#[feature(specialization)]`. The entire dispatch is zero-cost and the `#[cold]` hint steers branch prediction away from both constructors; the macro call site is simply `(&error).anyhow_kind().new(error)` — the mechanism is invisible.

### `ptr.rs` — typed pointer wrappers that encode ownership in the type system
[source](https://github.com/dtolnay/anyhow/blob/841522b2aa09732fecee40804440d2c35c68c480/src/ptr.rs)
```rust
#[repr(transparent)]
pub struct Own<T>
where
    T: ?Sized,
{
    pub ptr: NonNull<T>,
}

unsafe impl<T> Send for Own<T> where T: ?Sized {}

unsafe impl<T> Sync for Own<T> where T: ?Sized {}

impl<T> Copy for Own<T> where T: ?Sized {}

impl<T> Clone for Own<T>
where
    T: ?Sized,
{
    fn clone(&self) -> Self {
        *self
    }
}

impl<T> Own<T>
where
    T: ?Sized,
{
    pub fn new(ptr: Box<T>) -> Self {
        Own {
            ptr: unsafe { NonNull::new_unchecked(Box::into_raw(ptr)) },
        }
    }

    pub fn cast<U: CastTo>(self) -> Own<U::Target> {
        Own {
            ptr: self.ptr.cast(),
        }
    }

    pub unsafe fn boxed(self) -> Box<T> {
        unsafe { Box::from_raw(self.ptr.as_ptr()) }
    }

    pub fn by_ref(&self) -> Ref<T> {
        Ref {
            ptr: self.ptr,
            lifetime: PhantomData,
        }
    }

    pub fn by_mut(&mut self) -> Mut<T> {
        Mut {
            ptr: self.ptr,
            lifetime: PhantomData,
        }
    }
}
```
`Own<T>`, `Ref<'a, T>`, and `Mut<'a, T>` are three `repr(transparent)` wrappers around `NonNull<T>` that encode ownership at compile time without fat-pointer overhead — the foundation that makes a thin `anyhow::Error` possible. The `CastTo` trait forces an explicit turbofish on every `.cast::<U>()` call, making every erasure step visible in the source.

### `error.rs` — hand-rolled vtable that keeps `Error` a thin pointer
[source](https://github.com/dtolnay/anyhow/blob/841522b2aa09732fecee40804440d2c35c68c480/src/error.rs)
```rust
struct ErrorVTable {
    object_drop: unsafe fn(Own<ErrorImpl>),
    object_ref: unsafe fn(Ref<ErrorImpl>) -> Ref<dyn StdError + Send + Sync + 'static>,
    #[cfg(any(feature = "std", not(anyhow_no_core_error)))]
    object_boxed: unsafe fn(Own<ErrorImpl>) -> Box<dyn StdError + Send + Sync + 'static>,
    #[cfg(any(feature = "std", not(anyhow_no_core_error)))]
    object_reallocate_boxed: unsafe fn(Own<ErrorImpl>) -> Box<dyn StdError + Send + Sync + 'static>,
    object_downcast: unsafe fn(Ref<ErrorImpl>, TypeId) -> Option<Ref<()>>,
    object_drop_rest: unsafe fn(Own<ErrorImpl>, TypeId),
    #[cfg(all(not(error_generic_member_access), feature = "std"))]
    object_backtrace: unsafe fn(Ref<ErrorImpl>) -> Option<&Backtrace>,
}

// Safety: requires layout of *e to match ErrorImpl<E>.
unsafe fn object_drop<E>(e: Own<ErrorImpl>) {
    // Cast back to ErrorImpl<E> so that the allocator receives the correct
    // Layout to deallocate the Box's memory.
    let unerased_own = e.cast::<ErrorImpl<E>>();
    drop(unsafe { unerased_own.boxed() });
}

// Safety: requires layout of *e to match ErrorImpl<E>.
unsafe fn object_drop_front<E>(e: Own<ErrorImpl>, target: TypeId) {
    // Drop the fields of ErrorImpl other than E as well as the Box allocation,
    // without dropping E itself. This is used by downcast after doing a
    // ptr::read to take ownership of the E.
    let _ = target;
    let unerased_own = e.cast::<ErrorImpl<ManuallyDrop<E>>>();
    drop(unsafe { unerased_own.boxed() });
}
```
`ErrorVTable` is a plain struct of function pointers, not a trait object — it lives in the same allocation as the error and keeps the outer `Error` a single-word thin pointer. Every field has a `// Safety:` invariant spelled out above the function, and `#[cfg]` gates expose only the slots the current feature set actually uses.

### `context.rs` — private `mod ext` that unifies two error paths behind one trait
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
```
`mod ext` is private and its `StdError` shadow-trait is never exported; the two impls (one for any `E: std::error::Error`, one for `anyhow::Error` itself) unify behind `ext::StdError` so the public `Context` blanket impl handles both cases with a single where-clause. The comment "Not using map_err to save 2 useless frames" is characteristic: even incidental backtrace noise is deliberately cut.

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
```
`fallback::expand` ensures a broken `#[derive(Error)]` still emits a syntactically valid `Error` impl rather than flooding the user with secondary type errors — the macro recovers gracefully and reports exactly one error. The entry-point is four lines; all complexity is pushed down into `try_expand`, `impl_struct`, and `impl_enum`.

### `valid.rs` — exhaustive validation with precise, attribute-spanned error messages
[source](https://github.com/dtolnay/thiserror/blob/7214e0e8331d76afbea7173d8a14997512ac8713/impl/src/valid.rs)
```rust
fn check_non_field_attrs(attrs: &Attrs) -> Result<()> {
    if let Some(from) = &attrs.from {
        return Err(Error::new_spanned(
            from.original,
            "not expected here; the #[from] attribute belongs on a specific field",
        ));
    }
    if let Some(source) = &attrs.source {
        return Err(Error::new_spanned(
            source.original,
            "not expected here; the #[source] attribute belongs on a specific field",
        ));
    }
    if let Some(backtrace) = &attrs.backtrace {
        return Err(Error::new_spanned(
            backtrace,
            "not expected here; the #[backtrace] attribute belongs on a specific field",
        ));
    }
    if attrs.transparent.is_some() {
        if let Some(display) = &attrs.display {
            return Err(Error::new_spanned(
                display.original,
                "cannot have both #[error(transparent)] and a display attribute",
            ));
        }
        if let Some(fmt) = &attrs.fmt {
            return Err(Error::new_spanned(
                fmt.original,
                "cannot have both #[error(transparent)] and #[error(fmt = ...)]",
            ));
        }
    } else if let (Some(display), Some(_)) = (&attrs.display, &attrs.fmt) {
        return Err(Error::new_spanned(
            display.original,
            "cannot have both #[error(fmt = ...)] and a format arguments attribute",
        ));
    }

    Ok(())
}
```
Every error is anchored to the token it was found on (`Error::new_spanned(from.original, …)`) so the compiler underlines exactly the wrong attribute. The function returns early on the first violation and the messages name the correct placement, not just the problem — the user never has to guess where the attribute belongs.

### `fmt.rs` — inline unit tests co-located with the formatting implementation
[source](https://github.com/dtolnay/anyhow/blob/841522b2aa09732fecee40804440d2c35c68c480/src/fmt.rs)
```rust
#[cfg(test)]
mod tests {
    use super::*;
    use alloc::string::String;

    #[test]
    fn one_digit() {
        let input = "verify\nthis";
        let expected = "    2: verify\n       this";
        let mut output = String::new();

        Indented {
            inner: &mut output,
            number: Some(2),
            started: false,
        }
        .write_str(input)
        .unwrap();

        assert_eq!(expected, output);
    }

    #[test]
    fn two_digits() {
        let input = "verify\nthis";
        let expected = "   12: verify\n       this";
        let mut output = String::new();

        Indented {
            inner: &mut output,
            number: Some(12),
            started: false,
        }
        .write_str(input)
        .unwrap();

        assert_eq!(expected, output);
    }

    #[test]
    fn no_digits() {
        let input = "verify\nthis";
        let expected = "    verify\n    this";
        let mut output = String::new();

        Indented {
            inner: &mut output,
            number: None,
            started: false,
        }
        .write_str(input)
        .unwrap();

        assert_eq!(expected, output);
    }
}
```
Tests live inside `mod tests` in the same file as the code they exercise and construct the private `Indented` struct directly — no test helpers, no abstraction over the assertion. Each test is named for the variant it covers (`one_digit`, `two_digits`, `no_digits`), builds the exact input string, and compares against a verbatim expected output with whitespace counted by eye.
