-- Cockpit Dr Amraoui — migration 008 : médecins « leurs patients » par défaut.
-- Décision #7 : chacun voit ses éléments assignés par défaut ; la matrice élargit.
-- La RLS (patients_read / examens_read) filtre déjà sur medecin_assigne ; il
-- suffit de passer patients_all à 'none' pour le rôle médecin (l'admin peut
-- réélargir à 'full' via /admin/acces). Idempotent.
update app_permissions set level = 'none' where role = 'medecin' and area = 'patients_all';
