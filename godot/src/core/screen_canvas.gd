class_name ScreenCanvas
extends MeshInstance3D
## A flat, unlit 3D screen (CRT monitor, scoreboard) whose picture is painted
## with CanvasItem drawing calls:
##
##   screen.draw(func(ci: CanvasItem, w: float, h: float):
##       ci.draw_rect(Rect2(0, 0, w, h), Color.BLACK)
##       Env.draw_symbol(ci, "X", w / 2, h / 2, 30))
##
## Scanlines are added on top, like the web version's monitors.

var viewport: SubViewport
var painter: _Painter
var scanlines := true
var background := Color("#041004")


class _Painter extends Control:
	var fn: Callable
	var owner_screen: ScreenCanvas

	func _draw() -> void:
		var w := size.x
		var h := size.y
		draw_rect(Rect2(0, 0, w, h), owner_screen.background)
		if fn.is_valid():
			fn.call(self, w, h)
		if owner_screen.scanlines:
			var y := 0.0
			while y < h:
				draw_rect(Rect2(0, y, w, 1), Color(0, 0, 0, 0.35))
				y += 2.0


func _init(px_w: int = 128, px_h: int = 96, world_w: float = 1.4, world_h: float = 1.05) -> void:
	viewport = SubViewport.new()
	viewport.size = Vector2i(px_w, px_h)
	viewport.disable_3d = true
	viewport.transparent_bg = false
	viewport.render_target_update_mode = SubViewport.UPDATE_ONCE
	painter = _Painter.new()
	painter.owner_screen = self
	painter.size = Vector2(px_w, px_h)
	painter.texture_filter = CanvasItem.TEXTURE_FILTER_NEAREST
	viewport.add_child(painter)
	add_child(viewport)
	mesh = Geo.plane(world_w, world_h)
	cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	var m := StandardMaterial3D.new()
	m.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	m.texture_filter = BaseMaterial3D.TEXTURE_FILTER_NEAREST
	m.albedo_texture = viewport.get_texture()
	material_override = m


## Repaint the screen with fn(ci, w, h).
func draw(fn: Callable) -> void:
	painter.fn = fn
	painter.queue_redraw()
	viewport.render_target_update_mode = SubViewport.UPDATE_ONCE
