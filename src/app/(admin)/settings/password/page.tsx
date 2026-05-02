import { redirect } from 'next/navigation';

export default function PasswordRedirectPage() {
    redirect('/settings/profile');
}
