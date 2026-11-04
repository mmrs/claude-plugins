# Copilot session: copilot-fix-3

**Lead:** Two findings from the review of your API-12 change: a due date in the past is accepted, and `due_date` has no index. Reject past dates with a 400 through `ApiExceptionHandler`, add the index to V7, and test both.

**Copilot:** Past due dates now get a 400, and `due_date` has an index. 67 tests pass, three of them new. The rules from the brief hold, and nothing is left open.
