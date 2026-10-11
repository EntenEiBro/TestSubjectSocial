class_name Mats
## Materials with the game's flat, retro look.
##
##   Mats.mat(color, tex_ref, extra)   lit "Lambert" surface (THREE.MeshLambertMaterial)
##   Mats.glow(color, extra)           unlit colour (THREE.MeshBasicMaterial)
##
## `extra` keys (all optional):
##   opacity: float (enables alpha)   transparent: bool    double_side: bool
##   depth_write: false               emissive: color      emissive_intensity: float
##   additive: true                   no_fog: true         shadeless: true
## Colours are 0xRRGGBB ints, "#rrggbb" strings or Color.


static func mat(color: Variant = 0xffffff, tex: Variant = null, extra: Dictionary = {}) -> StandardMaterial3D:
	var m := StandardMaterial3D.new()
	m.albedo_color = U.col(color)
	m.diffuse_mode = BaseMaterial3D.DIFFUSE_LAMBERT
	m.specular_mode = BaseMaterial3D.SPECULAR_DISABLED
	m.roughness = 1.0
	m.metallic_specular = 0.0
	m.texture_filter = BaseMaterial3D.TEXTURE_FILTER_NEAREST_WITH_MIPMAPS
	_apply_tex(m, tex)
	_apply_extra(m, extra)
	return m


static func glow(color: Variant = 0xffffff, extra: Dictionary = {}) -> StandardMaterial3D:
	var m := StandardMaterial3D.new()
	m.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	m.albedo_color = U.col(color)
	m.texture_filter = BaseMaterial3D.TEXTURE_FILTER_NEAREST_WITH_MIPMAPS
	if extra.has("tex"):
		_apply_tex(m, extra.tex)
	_apply_extra(m, extra)
	return m


static func _apply_tex(m: StandardMaterial3D, tex: Variant) -> void:
	if tex is Dictionary and tex.get("tex") != null:
		m.albedo_texture = tex.tex
		var r: Vector2 = tex.get("rep", Vector2.ONE)
		m.uv1_scale = Vector3(r.x, r.y, 1.0)
	elif tex is Texture2D:
		m.albedo_texture = tex


static func _apply_extra(m: StandardMaterial3D, extra: Dictionary) -> void:
	if extra.get("double_side", false):
		m.cull_mode = BaseMaterial3D.CULL_DISABLED
	if extra.has("opacity") or extra.get("transparent", false):
		m.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
		m.albedo_color.a = float(extra.get("opacity", 1.0))
	if extra.has("depth_write") and not extra.depth_write:
		m.depth_draw_mode = BaseMaterial3D.DEPTH_DRAW_DISABLED
	if extra.has("emissive"):
		m.emission_enabled = true
		m.emission = U.col(extra.emissive)
		m.emission_energy_multiplier = float(extra.get("emissive_intensity", 1.0))
	if extra.get("additive", false):
		m.blend_mode = BaseMaterial3D.BLEND_MODE_ADD
		m.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
		m.depth_draw_mode = BaseMaterial3D.DEPTH_DRAW_DISABLED
	if extra.get("no_fog", false):
		m.disable_fog = true
	if extra.get("shadeless", false):
		m.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	if extra.get("no_shadow", false):
		m.disable_receive_shadows = true


## Change a material's opacity (enables alpha blending when needed).
static func set_opacity(m: StandardMaterial3D, a: float) -> void:
	if m.transparency == BaseMaterial3D.TRANSPARENCY_DISABLED:
		m.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	m.albedo_color.a = a


static func set_color(m: StandardMaterial3D, color: Variant) -> void:
	var a := m.albedo_color.a
	m.albedo_color = U.col(color, a)
