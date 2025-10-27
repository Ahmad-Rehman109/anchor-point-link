-- Create reports table for storing user reports with captured frames
CREATE TABLE public.reports (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  reported_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  frame_url TEXT,
  reporter_country TEXT,
  reported_country TEXT,
  metadata JSONB,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable Row Level Security
ALTER TABLE public.reports ENABLE ROW LEVEL SECURITY;

-- Allow anyone to insert reports (public reporting)
CREATE POLICY "Anyone can submit reports"
ON public.reports
FOR INSERT
WITH CHECK (true);

-- Only admins can view reports (future admin panel)
CREATE POLICY "Only admins can view reports"
ON public.reports
FOR SELECT
USING (false); -- Set to false for now, can be updated with admin role later

-- Create index for faster queries
CREATE INDEX idx_reports_created_at ON public.reports(created_at DESC);