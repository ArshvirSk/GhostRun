-- Add friendships and host_presence to supabase_realtime publication
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables 
    WHERE pubname = 'supabase_realtime' AND tablename = 'friendships'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.friendships;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables 
    WHERE pubname = 'supabase_realtime' AND tablename = 'host_presence'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.host_presence;
  END IF;
END $$;

ALTER TABLE public.friendships REPLICA IDENTITY FULL;
