drop index if exists public.idx_journal_entries_source_event_unique;

create unique index if not exists idx_journal_entries_source_event_unique
    on public.journal_entries (source_type, source_ref, source_event)
    where status = 'POSTED'
        and source_type is not null
        and source_ref is not null
        and source_event is not null;
