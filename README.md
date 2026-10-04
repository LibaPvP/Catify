# Catify

Put cat ears on any Minecraft skin, right in the browser.

- 3D preview you can spin, zoom and pan (with walk animation)
- Load a skin by username, upload, drag and drop, or paste
- Ear colour with hue / saturation / brightness sliders
- Solid, 2-colour or 3-colour top-to-bottom fades, plus quick presets
- "Match my hair colour" button
- Separate colour for the inner ear
- Download the finished 64×64 skin

## Hosting on GitHub Pages

1. Create a new repository and upload `index.html`, `style.css`, `ears.png` and `pink_stuff.png`.
2. Go to **Settings → Pages**, set the source to **Deploy from a branch**, pick `main` and `/ (root)`, and save.
3. After a minute your site is live at `https://<your-name>.github.io/<repo-name>/`.

## Changing the look

All styling is in `style.css`. The colours are variables at the top of the file (`--pink`, `--lav`, `--ink` and so on),
so changing a few hex values rethemes the whole site. A darker "night kitty" set of colours below them is used
automatically when the device is in dark mode.

## Changing the ear shape

`ears.png` is the ear shape (any colour, it gets recoloured) and `pink_stuff.png` is the inner ear.
Both are 64×64 skin-layout images. Edit them and push; the site picks them up automatically.
Darker pixels in `ears.png` stay darker after recolouring, so you can paint in shading.

(If you open `index.html` straight from your computer instead of a web server, the browser blocks
reading those PNGs, so the page uses built-in copies of the original designs.)
