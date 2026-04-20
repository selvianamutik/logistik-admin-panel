do $$
declare
    fk record;
    index_name text;
begin
    for fk in
        with fks as (
            select
                con.oid as constraint_oid,
                ns.nspname as schema_name,
                rel.relname as table_name,
                con.conname as constraint_name,
                con.conkey as key_attnums,
                array_agg(att.attname order by u.ord) as column_names
            from pg_constraint con
            join pg_class rel on rel.oid = con.conrelid
            join pg_namespace ns on ns.oid = rel.relnamespace
            join unnest(con.conkey) with ordinality as u(attnum, ord) on true
            join pg_attribute att on att.attrelid = rel.oid and att.attnum = u.attnum
            where con.contype = 'f'
              and ns.nspname = 'public'
            group by con.oid, ns.nspname, rel.relname, con.conname, con.conkey
        ),
        indexed_cols as (
            select
                idx.indrelid,
                array_agg(key.attnum::smallint order by key.ord) as indexed_attnums
            from pg_index idx
            join unnest(idx.indkey) with ordinality as key(attnum, ord) on true
            where idx.indisvalid
              and idx.indpred is null
              and key.attnum <> 0
            group by idx.indexrelid, idx.indrelid
        ),
        indexed as (
            select distinct f.constraint_oid
            from fks f
            join pg_constraint con on con.oid = f.constraint_oid
            join indexed_cols idx on idx.indrelid = con.conrelid
            where idx.indexed_attnums[1:cardinality(con.conkey)] = con.conkey
        )
        select
            f.schema_name,
            f.table_name,
            f.constraint_name,
            f.column_names,
            (
                select string_agg(format('%I', column_name), ', ')
                from unnest(f.column_names) as column_name
            ) as column_list
        from fks f
        left join indexed i on i.constraint_oid = f.constraint_oid
        where i.constraint_oid is null
        order by f.table_name, f.constraint_name
    loop
        index_name := left('idx_' || fk.table_name || '_' || array_to_string(fk.column_names, '_'), 63);
        execute format(
            'create index if not exists %I on %I.%I (%s)',
            index_name,
            fk.schema_name,
            fk.table_name,
            fk.column_list
        );
    end loop;
end $$;
