export function matchesPathSegment(pathname: string, basePath: string) {
    return pathname === basePath || pathname.startsWith(`${basePath}/`);
}
