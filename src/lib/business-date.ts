export const BUSINESS_TIME_ZONE = 'Asia/Jakarta';
const DATE_VALUE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const DATE_TIME_LOCAL_VALUE_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/;

type DatePartMap = {
    year: string;
    month: string;
    day: string;
    hour: string;
    minute: string;
    second: string;
};

export type BusinessCalendarDateParts = Pick<DatePartMap, 'year' | 'month' | 'day'>;

type BusinessCalendarDateTimeParts = DatePartMap;

export function parseBusinessDateValue(value: string): BusinessCalendarDateParts | null {
    const match = DATE_VALUE_RE.exec(value.trim());
    if (!match) {
        return null;
    }

    return {
        year: match[1],
        month: match[2],
        day: match[3],
    };
}

function parseBusinessDateTimeLocalValue(value: string): BusinessCalendarDateTimeParts | null {
    const match = DATE_TIME_LOCAL_VALUE_RE.exec(value.trim());
    if (!match) {
        return null;
    }

    return {
        year: match[1],
        month: match[2],
        day: match[3],
        hour: match[4],
        minute: match[5],
        second: match[6] || '00',
    };
}

export function getBusinessCalendarDateParts(
    value: Date | string = new Date(),
    timeZone: string = BUSINESS_TIME_ZONE,
): BusinessCalendarDateParts | null {
    if (typeof value === 'string') {
        const parsedDateValue = parseBusinessDateValue(value);
        if (parsedDateValue) {
            return parsedDateValue;
        }

        const parsedDateTimeLocalValue = parseBusinessDateTimeLocalValue(value);
        if (parsedDateTimeLocalValue) {
            return {
                year: parsedDateTimeLocalValue.year,
                month: parsedDateTimeLocalValue.month,
                day: parsedDateTimeLocalValue.day,
            };
        }
    }

    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) {
        return null;
    }

    const parts = getBusinessDateParts(date, timeZone);
    return {
        year: parts.year,
        month: parts.month,
        day: parts.day,
    };
}

function getBusinessDateParts(date: Date, timeZone: string = BUSINESS_TIME_ZONE): DatePartMap {
    const formatter = new Intl.DateTimeFormat('en-US', {
        timeZone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
    });

    const parts = formatter.formatToParts(date).reduce<Partial<DatePartMap>>((acc, part) => {
        if (part.type === 'year' || part.type === 'month' || part.type === 'day' || part.type === 'hour' || part.type === 'minute' || part.type === 'second') {
            acc[part.type] = part.value;
        }
        return acc;
    }, {});

    return {
        year: parts.year || '0000',
        month: parts.month || '01',
        day: parts.day || '01',
        hour: parts.hour || '00',
        minute: parts.minute || '00',
        second: parts.second || '00',
    };
}

export function getBusinessDateValue(date: Date = new Date(), timeZone: string = BUSINESS_TIME_ZONE) {
    const parts = getBusinessDateParts(date, timeZone);
    return `${parts.year}-${parts.month}-${parts.day}`;
}

export function getBusinessDateTimeLocalValue(date: Date = new Date(), timeZone: string = BUSINESS_TIME_ZONE) {
    const parts = getBusinessDateParts(date, timeZone);
    return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}

export function formatBusinessDate(
    value: Date | string = new Date(),
    locale: string = 'id-ID',
    options?: Intl.DateTimeFormatOptions,
    timeZone: string = BUSINESS_TIME_ZONE,
) {
    const parsedDateValue = typeof value === 'string' ? parseBusinessDateValue(value) : null;
    if (parsedDateValue) {
        const dateOnly = new Date(Date.UTC(
            Number(parsedDateValue.year),
            Number(parsedDateValue.month) - 1,
            Number(parsedDateValue.day),
        ));
        return new Intl.DateTimeFormat(locale, {
            timeZone: 'UTC',
            ...options,
        }).format(dateOnly);
    }

    const parsedDateTimeLocalValue =
        typeof value === 'string' ? parseBusinessDateTimeLocalValue(value) : null;
    if (parsedDateTimeLocalValue) {
        const dateTimeLocal = new Date(Date.UTC(
            Number(parsedDateTimeLocalValue.year),
            Number(parsedDateTimeLocalValue.month) - 1,
            Number(parsedDateTimeLocalValue.day),
            Number(parsedDateTimeLocalValue.hour),
            Number(parsedDateTimeLocalValue.minute),
            Number(parsedDateTimeLocalValue.second),
        ));
        return new Intl.DateTimeFormat(locale, {
            timeZone: 'UTC',
            ...options,
        }).format(dateTimeLocal);
    }

    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) {
        return typeof value === 'string' ? value : '';
    }

    return new Intl.DateTimeFormat(locale, {
        timeZone,
        ...options,
    }).format(date);
}

export function formatBusinessDateTime(
    value: Date | string = new Date(),
    locale: string = 'id-ID',
    options?: Intl.DateTimeFormatOptions,
    timeZone: string = BUSINESS_TIME_ZONE,
) {
    return formatBusinessDate(
        value,
        locale,
        {
            day: '2-digit',
            month: '2-digit',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            hour12: false,
            ...options,
        },
        timeZone,
    );
}

export function addDaysToDateValue(dateValue: string, days: number) {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateValue);
    if (!match) return '';

    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const utcDate = new Date(Date.UTC(year, month - 1, day));
    utcDate.setUTCDate(utcDate.getUTCDate() + days);

    const nextYear = utcDate.getUTCFullYear();
    const nextMonth = String(utcDate.getUTCMonth() + 1).padStart(2, '0');
    const nextDay = String(utcDate.getUTCDate()).padStart(2, '0');
    return `${nextYear}-${nextMonth}-${nextDay}`;
}
