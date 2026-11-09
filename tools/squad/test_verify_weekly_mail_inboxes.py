"""Synthetic MIME parser tests only; these are not real inbox evidence."""
import copy
import hashlib
import tempfile
import unittest
import uuid
from email import policy
from email.message import EmailMessage
from email.parser import BytesParser
from pathlib import Path

from verify_weekly_mail_inboxes import verify


class WeeklyMailInboxProof(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.pdf = b'%PDF-1.7\nSynthetic parser fixture only\n%%EOF\n'
        self.manifest = {'run_id': str(uuid.uuid4()), 'deliveries': []}
        self.paths = []
        for index, (kind, role) in enumerate([
            ('catalogue', 0), ('delivery_challan', 3),
            ('tailor_weekly', 0), ('tailor_weekly', 2), ('tailor_weekly', 4),
        ]):
            self.manifest['deliveries'].append({
                'job_id': str(uuid.uuid4()), 'document_id': str(uuid.uuid4()),
                'email': f'squad-mime-fixture-{index}@mailinator.com',
                'kind': kind, 'role_id': role, 'bytes': len(self.pdf),
                'sha256': hashlib.sha256(self.pdf).hexdigest(), 'pages': 1,
            })
            self.paths.append(Path(self.directory.name) / f'{index}.eml')
            self.write(index)

    def write(self, index, *, recipient=None, identity=None, document=None,
              attachments=None, extra_header=None):
        item = self.manifest['deliveries'][index]
        msg = EmailMessage(policy=policy.SMTP)
        msg['From'] = 'fixture@example.invalid'
        msg['To'] = recipient or item['email']
        msg['Message-ID'] = identity or f"<squad-business-{item['job_id']}@scottinternational.com>"
        msg['Subject'] = 'Synthetic MIME parser fixture'
        msg.set_content('Document: ' + (document or item['document_id']))
        for number, data in enumerate([self.pdf] if attachments is None else attachments):
            msg.add_attachment(data, maintype='application', subtype='pdf', filename=f'fixture-{number}.pdf')
        raw = msg.as_bytes()
        # EmailMessage refuses duplicate singleton headers. Prefix raw MIME to
        # reproduce the ambiguity that actual downloaded messages can contain.
        if extra_header is not None:
            raw = extra_header.encode() + b'\r\n' + raw
        self.paths[index].write_bytes(raw)

    def denied(self, paths=None, manifest=None):
        with self.assertRaises(AssertionError):
            verify(manifest or self.manifest, self.paths if paths is None else paths)

    def test_five_exact_messages_verify_without_claiming_provider_execution(self):
        result = verify(self.manifest, self.paths)
        self.assertTrue(result['inbox_verified'])
        self.assertEqual(len(result['messages']), 5)
        self.assertEqual({x['job_id'] for x in result['messages']},
                         {x['job_id'] for x in self.manifest['deliveries']})
        self.assertNotIn('smtp_accepted', result)
        self.assertTrue(all(x['attachment_sha256'] == hashlib.sha256(self.pdf).hexdigest()
                            for x in result['messages']))

    def test_real_delivery_shape_shared_weekly_document_and_two_admin_messages(self):
        # One weekly PDF is delivered to three role aliases; Admin also gets
        # a distinct catalogue in the same inbox. Neither alone is ambiguous.
        weekly_id = self.manifest['deliveries'][2]['document_id']
        self.manifest['deliveries'][2]['email'] = self.manifest['deliveries'][0]['email']
        for index in (2, 3, 4):
            self.manifest['deliveries'][index]['document_id'] = weekly_id
        for index in range(5):
            self.write(index, identity=f'<provider-{index}@mailersend.net>')
        result = verify(self.manifest, self.paths)
        self.assertEqual(len(result['messages']), 5)
        self.assertTrue(all(x['message_id_rewritten'] for x in result['messages']))

    def test_same_delivery_with_different_received_id_still_rejected(self):
        item = self.manifest['deliveries'][0]
        self.write(1, recipient=item['email'], document=item['document_id'],
                   identity='<second-copy@mailersend.net>')
        self.denied()

    def test_wrong_recipient_rejected(self):
        self.write(0, recipient='other@mailinator.com')
        self.denied()

    def test_non_mailinator_recipient_requires_the_same_exact_manifest_binding(self):
        self.manifest['deliveries'][0]['email'] = 'controlled-fixture@example.invalid'
        self.write(0)
        self.assertTrue(verify(self.manifest, self.paths)['inbox_verified'])
        self.write(0, recipient='different-fixture@example.invalid')
        self.denied()

    def test_provider_rewritten_identity_requires_full_binding(self):
        self.write(0, identity='<provider-rewritten@mailersend.net>')
        result = verify(self.manifest, self.paths)
        proof = result['messages'][0]
        self.assertTrue(proof['message_id_rewritten'])
        self.assertEqual(proof['inbox_observed_message_id'], '<provider-rewritten@mailersend.net>')
        self.assertEqual(proof['smtp_submitted_message_id'],
                         f"<squad-business-{self.manifest['deliveries'][0]['job_id']}@scottinternational.com>")
        self.write(0, identity='<provider-rewritten@mailersend.net>', recipient='wrong@example.invalid')
        self.denied()

    def test_duplicate_received_id_rejected_even_with_distinct_correct_bindings(self):
        self.write(0, identity='<same@mailersend.net>')
        self.write(1, identity='<same@mailersend.net>')
        self.denied()

    def test_other_intended_submitted_id_is_not_a_rewrite(self):
        self.write(0, identity=f"<squad-business-{self.manifest['deliveries'][1]['job_id']}@scottinternational.com>")
        self.denied()

    def test_manifest_collision_rejected_before_matching(self):
        manifest = copy.deepcopy(self.manifest)
        manifest['deliveries'][1].update(email=manifest['deliveries'][0]['email'],
                                         document_id=manifest['deliveries'][0]['document_id'])
        self.denied(manifest=manifest)

    def test_full_plus_alias_not_normalized_to_base_or_other_alias(self):
        self.manifest['deliveries'][0]['email'] = 'inbox+run-admin@example.invalid'
        self.write(0, identity='<rewritten@mailersend.net>')
        self.assertTrue(verify(self.manifest, self.paths)['inbox_verified'])
        for address in ['inbox@example.invalid', 'inbox+run-customer@example.invalid',
                        'Inbox+run-admin@example.invalid']:
            self.write(0, recipient=address, identity='<rewritten@mailersend.net>')
            self.denied()

    def test_document_must_be_unique_and_anchored(self):
        for content in ['Quoted Document: {id}', 'Document: {id} suffix',
                        'Document: {id}\nDocument: {id}',
                        'Document: {id}\nDocument: invalid']:
            self.write(0)
            msg = BytesParser(policy=policy.default).parsebytes(self.paths[0].read_bytes())
            msg.get_body(preferencelist=('plain',)).set_content(
                content.format(id=self.manifest['deliveries'][0]['document_id']))
            self.paths[0].write_bytes(msg.as_bytes())
            self.denied()

    def test_extra_non_pdf_attachment_rejected(self):
        msg = BytesParser(policy=policy.default).parsebytes(self.paths[0].read_bytes())
        msg.add_attachment(b'extra', maintype='text', subtype='plain', filename='extra.txt')
        self.paths[0].write_bytes(msg.as_bytes())
        self.denied()

    def test_rewrite_does_not_accept_wrong_pdf(self):
        self.write(0, identity='<rewritten@mailersend.net>', attachments=[self.pdf + b'changed'])
        self.denied()

    def test_missing_document_identity_rejected(self):
        self.write(0, document=str(uuid.uuid4()))
        self.denied()

    def test_changed_attachment_with_same_length_rejected(self):
        self.write(0, attachments=[self.pdf.replace(b'Synthetic', b'Different')])
        self.denied()

    def test_changed_attachment_length_rejected(self):
        self.write(0, attachments=[self.pdf + b'additional'])
        self.denied()

    def test_duplicate_or_missing_messages_rejected(self):
        self.denied(paths=self.paths[:4])
        self.denied(paths=[*self.paths[:4], self.paths[0]])
        self.denied(paths=[*self.paths, self.paths[0]])

    def test_missing_or_multiple_pdf_attachments_rejected(self):
        for attachments in [[], [self.pdf, self.pdf]]:
            with self.subTest(count=len(attachments)):
                self.write(0, attachments=attachments)
                self.denied()

    def test_non_pdf_bytes_rejected_even_with_matching_manifest_digest(self):
        content = b'not a PDF'
        self.write(0, attachments=[content])
        manifest = copy.deepcopy(self.manifest)
        manifest['deliveries'][0].update(bytes=len(content), sha256=hashlib.sha256(content).hexdigest())
        self.denied(manifest=manifest)

    def test_duplicate_message_id_headers_rejected_even_if_first_is_expected(self):
        identity = f"<squad-business-{self.manifest['deliveries'][0]['job_id']}@scottinternational.com>"
        self.write(0, identity='<other@example.invalid>', extra_header='Message-ID: ' + identity)
        self.denied()

    def test_duplicate_to_headers_or_multiple_to_addresses_rejected(self):
        email = self.manifest['deliveries'][0]['email']
        self.write(0, extra_header='To: ' + email)
        self.denied()
        self.write(0, recipient=email + ', other@mailinator.com')
        self.denied()

    def test_missing_identity_or_recipient_header_rejected(self):
        for header in [b'Message-ID:', b'To:']:
            with self.subTest(header=header):
                self.write(0)
                raw = self.paths[0].read_bytes()
                self.paths[0].write_bytes(b'\r\n'.join(line for line in raw.split(b'\r\n') if not line.startswith(header)))
                self.denied()


if __name__ == '__main__':
    unittest.main()
