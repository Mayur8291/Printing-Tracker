import { MessageCircle, Phone } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { contactLinks } from './contactModel';

export default function ContactActions({ phone, name = 'this person', environment, className = '' }) {
  const links = contactLinks(phone);
  if (!links) return <p className={`text-xs text-muted-foreground ${className}`}>A valid contact number is not available.</p>;
  const live = environment === 'production';
  return <div className={`space-y-2 ${className}`}><div className="flex flex-wrap gap-2">{live ? <><Button asChild size="sm" variant="outline"><a href={links.whatsapp} target="_blank" rel="noopener noreferrer" aria-label={`WhatsApp ${name}`}><MessageCircle className="mr-2 size-4" aria-hidden="true"/>WhatsApp</a></Button><Button asChild size="sm" variant="outline"><a href={links.telephone} aria-label={`Call ${name}`}><Phone className="mr-2 size-4" aria-hidden="true"/>Call</a></Button></> : <><Button size="sm" variant="outline" disabled><MessageCircle className="mr-2 size-4" aria-hidden="true"/>WhatsApp</Button><Button size="sm" variant="outline" disabled><Phone className="mr-2 size-4" aria-hidden="true"/>Call</Button></>}</div>{!live && <p className="text-xs text-muted-foreground">External contact actions are disabled in staging.</p>}</div>;
}
