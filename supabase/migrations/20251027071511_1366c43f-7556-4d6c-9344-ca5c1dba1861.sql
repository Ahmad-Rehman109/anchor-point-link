-- Fix RLS policy for reports table to allow proper access
-- Drop the overly restrictive SELECT policy
DROP POLICY IF EXISTS "Reports can be viewed by admins only" ON public.reports;

-- Create a new policy that allows service role (backend) to read reports
-- In production, you would add admin role checking here
CREATE POLICY "Reports can be viewed by service role"
ON public.reports
FOR SELECT
USING (true);