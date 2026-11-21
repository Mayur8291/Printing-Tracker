import io, unittest
from PIL import Image
from media_renditions import render,SIZES
class RenditionTests(unittest.TestCase):
    def data(self,size=(1800,900),mode='RGB',fmt='JPEG'):
        image=Image.new(mode,size);out=io.BytesIO();image.save(out,format=fmt);return out.getvalue()
    def test_deterministic_bounded_and_metadata_free(self):
        source=self.data();first=list(render(source));self.assertEqual(first,list(render(source)))
        for variant,payload,mime in first:
            with Image.open(io.BytesIO(payload)) as image:
                self.assertLessEqual(max(image.size),SIZES[variant]);self.assertEqual(image.width,image.height*2);self.assertFalse(image.getexif());self.assertEqual(mime,'image/jpeg')
    def test_alpha_preserved_and_small_images_not_upscaled(self):
        for _,payload,mime in render(self.data((16,8),'RGBA','PNG')):
            image=Image.open(io.BytesIO(payload));self.assertEqual(image.size,(16,8));self.assertEqual(image.mode,'RGBA');self.assertEqual(mime,'image/png')
    def test_png_exif_is_not_copied_to_derivatives(self):
        original=Image.new('RGBA',(24,12));exif=Image.Exif();exif[315]='private author';source=io.BytesIO();original.save(source,format='PNG',exif=exif)
        for _,payload,_ in render(source.getvalue()):
            with Image.open(io.BytesIO(payload)) as image:self.assertFalse(image.getexif())
    def test_camera_jpeg_downsamples_before_full_decode(self):
        variants=list(render(self.data((6000,4000))))
        self.assertEqual(len(variants),3)
        for variant,payload,mime in variants:
            with Image.open(io.BytesIO(payload)) as image:
                self.assertLessEqual(max(image.size),SIZES[variant])
                self.assertEqual(mime,'image/jpeg')
    def test_legacy_webp_with_jpeg_metadata_gets_safe_raster_derivatives(self):
        variants=list(render(self.data((1440,1440),'RGB','WEBP')))
        self.assertEqual(len(variants),3)
        for variant,payload,mime in variants:
            self.assertIn(mime,('image/jpeg','image/png'))
            with Image.open(io.BytesIO(payload)) as image:self.assertLessEqual(max(image.size),SIZES[variant])
    def test_large_png_remains_bounded(self):
        with self.assertRaises(ValueError):list(render(self.data((4096,4096),'RGB','PNG')))
    def test_hostile_or_unsupported_inputs_rejected(self):
        for data in [b'',b'not an image',b'x'*(10*1024*1024+1),self.data((4097,1)),self.data((20,20),'RGB','GIF')]:
            with self.assertRaises(Exception):list(render(data))
if __name__=='__main__':unittest.main()
