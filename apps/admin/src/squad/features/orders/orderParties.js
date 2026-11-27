export const ORDER_SEARCH_PLACEHOLDER = 'Search order number, customer, dealer or distributor';
const clean = value => typeof value === 'string' ? value.trim() : '';
function party(label, id, name, company) {
  const contact = clean(name), business = clean(company);
  return { label, name: business || contact || (id ? `${label} #${id}` : 'Name unavailable'), contact: business && contact && business.toLowerCase() !== contact.toLowerCase() ? contact : '' };
}
/** Names are supplied by the scoped order API, never fetched from an unrestricted people list. */
export function orderParties(order) {
  const buyer = party(Number(order.customer_role) === 10 ? 'Dealer / distributor' : 'Customer', order.customer_id, order.customer_name, order.customer_company_name);
  const dealer = order.customer_dealer_id && String(order.customer_dealer_id) !== String(order.customer_id)
    ? party('Dealer / distributor', order.customer_dealer_id, order.dealer_name, order.dealer_company_name) : null;
  return dealer ? [buyer, dealer] : [buyer];
}
export function orderPartySummary(order) { return orderParties(order).map(p => `${p.label}: ${p.name}${p.contact ? ` (${p.contact})` : ''}`).join(' · '); }
