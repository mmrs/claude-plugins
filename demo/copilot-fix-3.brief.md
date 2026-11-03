Two things from review on API-12: reject a due date in the past with a 400 (same error shape as a blank title), and add an index on `due_date` in the same migration. Add a test for each.
