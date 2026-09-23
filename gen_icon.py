from PIL import Image, ImageDraw

S = 512
img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
d = ImageDraw.Draw(img)

# 圆角背景（iOS 绿色）
r = 112
d.rounded_rectangle([0, 0, S, S], radius=r, fill=(52, 199, 89, 255))

# 白色硬币圆
cx, cy = S // 2, S // 2
cr = 150
d.ellipse([cx - cr, cy - cr, cx + cr, cy + cr], fill=(255, 255, 255, 255))

# ¥ 符号（红色）
red = (255, 59, 48, 255)
w = 16
# 顶部 V（Y 的上半）
d.line([(cx - 70, cy - 55), (cx, cy + 5)], fill=red, width=w, joint="curve")
d.line([(cx + 70, cy - 55), (cx, cy + 5)], fill=red, width=w, joint="curve")
# 竖线（Y 的下半）
d.line([(cx, cy + 5), (cx, cy + 75)], fill=red, width=w, joint="curve")
# 两条横线（¥ 特征）
d.line([(cx - 60, cy + 20), (cx + 60, cy + 20)], fill=red, width=w)
d.line([(cx - 60, cy + 50), (cx + 60, cy + 50)], fill=red, width=w)

img.save("icon.png")
print("icon.png generated", img.size)
