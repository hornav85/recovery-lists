import { normalizePhone, telHref } from "@/lib/phone";

/** Clickable `tel:+1XXXXXXXXXX` when the number is a valid US phone. */
export function PhoneLink({ phone }: { phone: string | null | undefined }) {
  const shown = normalizePhone(phone);
  if (!shown) return <>—</>;
  const href = telHref(shown);
  if (!href) return <>{shown}</>;
  return <a href={href}>{shown}</a>;
}
