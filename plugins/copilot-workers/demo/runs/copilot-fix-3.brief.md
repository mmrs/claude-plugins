Two findings from the review of your API-12 change, both yours to fix in this session:

1. A due date in the past is accepted. Reject it with a 400: `@FutureOrPresent` on `TaskRequest.dueDate`, so it goes through `ApiExceptionHandler` like a blank title does.
2. `due_date` has no index, and the web app will query overdue tasks. Add it to `V7__task_due_date.sql` rather than a new V8: V7 hasn't left this branch.

Add a test for each, plus one showing today's date is accepted. Same rules as before: DTOs in `todo/task/dto`, errors through `ApiExceptionHandler`, no request bodies in logs.

Run `./mvnw -q test` and make it pass before you stop. End with the same short report as last time.
