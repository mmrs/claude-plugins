Review the API-12 change in todo-api before it goes further: `git diff main...HEAD`. You're the reviewer because the user asked for a review of this one. You can't write files; report only.

API-12 adds a nullable `due_date` to tasks, accepted on create and update and returned in the response. Check:
- Validation: is every bad `dueDate` rejected with a 400 in the same shape as a blank title?
- The migration: is it a new Flyway version, and does it support the overdue query the web app will run (`due_date < today`)?
- The rules from the implementation brief: DTOs in `todo/task/dto`, errors through `ApiExceptionHandler`, no request bodies in logs.

End with a short report: each finding with file and line, how serious it is and what you'd change. Say plainly if you found nothing.
