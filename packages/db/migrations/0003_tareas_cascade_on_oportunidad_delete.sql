-- Sin esto, borrar una oportunidad con tareas vinculadas falla con una violación de clave foránea
-- (la FK original no tenía ON DELETE). Una tarea sin su oportunidad no tiene sentido, así que se
-- borra en cascada junto con ella — igual que ya hacen notas, pagos, trámites y solicitudes.
ALTER TABLE gozz.tareas DROP CONSTRAINT tareas_oportunidad_id_fkey;

ALTER TABLE gozz.tareas
    ADD CONSTRAINT tareas_oportunidad_id_fkey
    FOREIGN KEY (oportunidad_id) REFERENCES gozz.oportunidades(id) ON DELETE CASCADE;
