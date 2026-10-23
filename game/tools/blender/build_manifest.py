"""Merge work/manifest_parts/*.json into assets/models/manifest.json (adds file size).
blender -b --factory-startup --python build_manifest.py"""
import json, os, glob
OUT = r"D:\HoangKiet\armywwar\game\assets\models"
PARTS = r"D:\HoangKiet\armywwar\game\tools\blender\work\manifest_parts"
man = {}
for p in sorted(glob.glob(os.path.join(PARTS, "*.json"))):
    d = json.load(open(p, encoding="utf-8"))
    for k, v in d.items():
        f = os.path.join(OUT, v["file"])
        if not os.path.exists(f):
            print("[MAN] missing glb", k); continue
        v["bytes"] = os.path.getsize(f)
        v["preview"] = "preview/%s.png" % k
        man[k] = v
json.dump(man, open(os.path.join(OUT, "manifest.json"), "w", encoding="utf-8"), indent=2, ensure_ascii=False)
for k, v in man.items():
    print("[MAN] %-20s %-45s tris=%6d  %7.0f KB  anim=%s" % (k, v["source"][:45], v["tris"], v["bytes"] / 1024, v["animations"]))
print("[MAN] total", len(man))
