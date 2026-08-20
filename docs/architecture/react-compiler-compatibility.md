# React Compiler compatibility

The renderer has two deliberate React Compiler exclusions. The findings list
and activity list call TanStack Virtual's `useVirtualizer`. That hook returns
imperative functions whose identities can change as measurements and scroll
state change. The React Hooks lint plugin marks it as incompatible with compiler
memoization.

React Compiler skips only those two route components. The virtualizers keep
their normal TanStack lifecycle, and neither returned object crosses into a
memoized child or another hook. This is the library's expected compatibility
boundary, not a runtime failure.

Each call has a line-scoped `react-hooks/incompatible-library` suppression. A
broad file or configuration suppression is not allowed. `bun run lint` is the
regression check and must finish with no warnings. Remove the exclusions after
TanStack Virtual publishes a compiler-compatible API and the virtualized lists
pass keyboard, resize, and scrolling checks.
