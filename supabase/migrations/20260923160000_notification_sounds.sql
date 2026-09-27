-- Chants d'oiseaux joints aux pushs « Qui chante ? » (ios_attachments).
-- Public comme `notification-images` : l'extension de notification les
-- télécharge sans jeton. Écriture réservée au service role (aucune politique).
-- 1 Mo : l'extension iOS dispose de peu de temps et de mémoire pour télécharger.
insert into storage.buckets (id, name, public, allowed_mime_types, file_size_limit)
values ('notification-sounds', 'notification-sounds', true, array['audio/mpeg'], 1000000)
on conflict (id) do nothing;
