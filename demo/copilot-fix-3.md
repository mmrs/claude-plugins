# Copilot session: copilot-fix-3

**Lead:** Two things from review on API-12: reject a due date in the past with a 400, and add an index on `due_date`.

**Copilot:** Past due dates now get a 400, and `due_date` has an index. 67 tests pass, three of them new.
