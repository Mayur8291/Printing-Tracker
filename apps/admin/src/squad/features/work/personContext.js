import { useSquadQuery } from '../../data/hooks';

/** A deep link selects a person; it never supplies their identity or authority. */
export function usePersonContext(sdk, parameter, roles) {
  const value = new URLSearchParams(window.location.search).get(parameter);
  const id = /^[1-9][0-9]{0,18}$/.test(value || '') && BigInt(value) <= 9223372036854775807n ? value : null;
  const invalid = value !== null && !id;
  const query = useSquadQuery(['work-person-context', parameter, id, roles.join(',')], async ({sdk}) => {
    const person = await sdk.person(id);
    if (String(person.id) !== id || !roles.includes(person.role)) {
      const error = new Error('This person is not available for this workflow.');
      error.kind = 'forbidden';
      throw error;
    }
    return person;
  }, { enabled: !!id });
  return { id, invalid, query, person: query.error ? null : query.data, ready: !invalid && !query.error && (!id || !!query.data) };
}
