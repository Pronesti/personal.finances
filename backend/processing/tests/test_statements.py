import json
from pathlib import Path
import shutil
import sys
import tempfile
import unittest

PROCESSING = Path(__file__).resolve().parents[1]
FIXTURES = PROCESSING.parents[1] / 'docs/rebuild/fixtures'
sys.path.insert(0, str(PROCESSING))
from pdf_to_json import convert, UnknownLayout

class Statements(unittest.TestCase):
    def test_complete_envelopes(self):
        for brand in ['visa', 'mastercard', 'mercadopago']:
            with self.subTest(brand=brand):
                expected = json.loads((FIXTURES / (brand + '.expected.json')).read_text())
                self.assertEqual(convert(FIXTURES / 'pdf' / expected['file']), expected)

    def test_unsupported_layout_never_enters_admission(self):
        with self.assertRaises(UnknownLayout):
            convert(FIXTURES / 'pdf/unsupported-layout.pdf')

    def test_mercadopago_requires_filename_year(self):
        with tempfile.TemporaryDirectory(prefix='tarjetas-synthetic-parser-') as directory:
            pdf = Path(directory) / 'mercadopago_without_year.pdf'
            shutil.copyfile(FIXTURES / 'pdf/synthetic_mercadopago_2026_02.pdf', pdf)
            with self.assertRaisesRegex(UnknownLayout, 'filename must include one'):
                convert(pdf)

if __name__ == '__main__':
    unittest.main()
