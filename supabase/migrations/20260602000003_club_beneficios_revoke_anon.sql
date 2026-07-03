-- Quitar del API anon las tablas que no son de catalogo publico.
-- RLS ya filtra filas, pero esto las saca del GraphQL surface de anon
-- (patron documentado: revocar de cada rol especifico).
revoke select on public.benefit_redemptions   from anon;
revoke select on public.partner_company_staff from anon;
