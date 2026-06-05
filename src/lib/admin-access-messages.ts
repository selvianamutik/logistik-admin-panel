export type AdminLoadNotice = {
    title: string;
    text: string;
};

export function getAdminErrorMessage(error: unknown, fallbackMessage: string) {
    return error instanceof Error && error.message.trim()
        ? error.message
        : fallbackMessage;
}

export function isAccessDeniedMessage(message: string) {
    return /forbidden|tidak punya|akses|permission|unauthorized/i.test(message);
}

export function isNotFoundMessage(message: string) {
    return /not found|tidak ditemukan/i.test(message);
}

export function buildAdminLoadNotice(
    message: string,
    resourceLabel: string,
    accessText: string
): AdminLoadNotice {
    if (isAccessDeniedMessage(message)) {
        return {
            title: `Akses ${resourceLabel} dibatasi`,
            text: accessText,
        };
    }

    return {
        title: `${resourceLabel} belum bisa dimuat`,
        text: message,
    };
}
