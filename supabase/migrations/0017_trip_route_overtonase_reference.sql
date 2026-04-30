alter table if exists public.trip_route_rates
    add column if not exists overtonase_driver_rate_per_ton numeric;

with parsed as (
    select
        source_document_id,
        nullif(regexp_replace(parsed_match.match_values[1], '\.', '', 'g'), '')::numeric as parsed_rate
    from public.trip_route_rates
    cross join lateral regexp_match(
        notes,
        'Referensi overtonase admin:\s*Rp\s*([0-9.]+)\s*/\s*ton',
        'i'
    ) as parsed_match(match_values)
    where notes is not null
)
update public.trip_route_rates as rates
set overtonase_driver_rate_per_ton = parsed.parsed_rate
from parsed
where rates.source_document_id = parsed.source_document_id
    and rates.overtonase_driver_rate_per_ton is null
    and parsed.parsed_rate > 0;
