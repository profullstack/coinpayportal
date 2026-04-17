# WordPress.org assets

Files in this directory are **not** bundled into the installable plugin zip. They are pushed separately to the WordPress.org `/assets/` SVN path by the `10up/action-wordpress-plugin-deploy` action via `ASSETS_DIR`.

## Required files (produce these before enabling WP.org deploy)

| File | Dimensions | Purpose |
|------|-----------|---------|
| `banner-772x250.png` | 772×250 | Banner on the plugin listing page |
| `banner-1544x500.png` | 1544×500 | Retina banner (2× of above) |
| `icon-128x128.png` | 128×128 | Plugin icon on search results |
| `icon-256x256.png` | 256×256 | Retina icon |
| `screenshot-1.png` … `screenshot-5.png` | varies | Matches the five `== Screenshots ==` captions in `readme.txt` |

Optional `icon.svg` is preferred when available — WordPress.org scales it cleanly.

## After you add the images

Update `plugins-release.yml` to point the 10up action at this dir:

```yaml
- name: Deploy to WordPress.org SVN
  uses: 10up/action-wordpress-plugin-deploy@stable
  env:
    ...
    ASSETS_DIR: ./plugins/woocommerce/coinpay-woocommerce/.wordpress-org
```

## Design brief

- Primary: CoinPay brand color on dark background.
- Include visible cues for both crypto (Bitcoin-style coin stack) and card (generic card icon) to telegraph dual-rail support.
- Logotype should be legible at 128×128.
