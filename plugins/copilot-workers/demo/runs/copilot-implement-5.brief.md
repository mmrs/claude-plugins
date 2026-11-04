Show each task's due date in the task list in todo-web (WEB-7), and highlight overdue ones. You're on this as the Frontend Developer: it's a React change only.

What to build: the due date next to each task in `TaskList.tsx`, and an overdue task (due before today, in the user's time zone) highlighted.

Where it goes and why:
- Format the date with the existing `formatDate` in `src/lib/dates.ts`, the way `TaskDetail.tsx` shows created dates.
- Highlight with the `text-danger` class the list already uses for failed saves. No new colours.
- A task without a due date shows nothing, not a placeholder.

Out of scope: editing the due date (the edit form) and the API, which already returns `dueDate` (API-12).

Rules this change is most likely to break, so check your diff against them before you finish:
- No new date library; `src/lib/dates.ts` covers it.
- Components stay in `src/components/tasks`.

Run `npm test -- --run` and make it pass before you stop. Don't commit.

End with a short report: the files you changed and why, each rule above and how the diff keeps it, the command you ran and its result, and anything you left open.
