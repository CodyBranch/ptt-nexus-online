-- Entered runners and alternates: a coach's swap on the declaration form.
--
-- An alternate comes into a race only by swapping with a runner the school
-- has in it. The alternate's answer is 'declared' in that race with swap_for
-- naming the runner they went in for; the runner's is 'swapped' with swap_for
-- naming the alternate. Undone, the alternate's becomes 'unswapped' (so the
-- desk knows to put both back) and the runner's answer is cleared.
--
-- Run it before the desk publishes a meet that declares this way.

ALTER TABLE "declaration_submissions" ADD COLUMN IF NOT EXISTS "swap_for" text;
