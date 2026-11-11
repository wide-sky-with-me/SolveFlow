-- Reverse authorization and image-family lookups must not scan unrelated photos.
CREATE INDEX revision_images_asset ON exam_app.revision_images(asset_id,revision_id);
CREATE INDEX media_assets_parent_variant ON exam_app.media_assets(parent_asset_id,variant)
  WHERE parent_asset_id IS NOT NULL;
