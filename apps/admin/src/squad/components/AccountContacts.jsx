import { useState } from 'react';
import { useSquadQuery } from '../data/hooks';
import { Field, ResourceState, SectionCard } from './index.jsx';
import ContactActions from './ContactActions';
import { accountContacts } from './contactModel';

// Reuses the current account's scoped person response; no directory or manager search.
export default function AccountContacts({ sdk, identity, environment }) {
  const allowed = [3, 10].includes(Number(identity.role));
  const [selected, setSelected] = useState('');
  const query = useSquadQuery(['account-contacts', environment, identity.id], ({sdk}) => sdk.person(identity.id), { enabled: allowed });
  if (!allowed) return null;
  const contacts = accountContacts(query.data);
  const contact = contacts.find(item => String(item.id) === selected) || contacts[0];
  return <SectionCard title="Your account team" description={contacts.length > 1 ? 'Choose a linked dealership to contact.' : 'Contact the person responsible for your account.'}>
    {query.isLoading ? <ResourceState status="loading" title="Loading account contacts"/> : query.error ? <ResourceState status="error" title="Account contacts unavailable" onRetry={query.refetch}/> : !contact ? <p className="text-sm text-muted-foreground">An account manager has not been assigned yet.</p> : <div className="space-y-4">
      {contacts.length > 1 ? <Field label="Linked dealership"><select className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={String(contact.id)} onChange={event => setSelected(event.target.value)}>{contacts.map(item => <option key={item.id} value={String(item.id)}>{item.name || `Dealership #${item.id}`}</option>)}</select></Field> : <p className="text-sm font-medium">{contact.name || 'Your account manager'}</p>}
      <ContactActions phone={contact.phone} name={contact.name || 'your account manager'} environment={environment}/>
    </div>}
  </SectionCard>;
}
