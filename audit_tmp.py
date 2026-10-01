import json
m = json.load(open("/tmp/gen-probe/manifest.json"))
print("generator:", m["generator"], " regions:", m["regions"])
print("licence:", m["licence"]["id"], "|", m["licence"]["attribution"][:60])
print()
for e in m["entries"]:
    b = e["bounds"]
    size = [round(b["max"][i]-b["min"][i],1) for i in range(3)]
    print(f"  {e['asiId']:<40} mesh={e['meshName']:<9} side={e['laterality']:<6} tris={e['geometry']['triangles']:>5} size={size} fma={e['fma']['conceptId']}")
print()
print("=== is any geometry near the ORIGIN? (that is how a bad binding shows) ===")
for e in m["entries"]:
    c = [round((e["bounds"]["min"][i]+e["bounds"]["max"][i])/2,1) for i in range(3)]
    print(f"  {e['asiId']:<40} centre={c}")
print()
print("=== bounds min/max per entry, to see the coordinate frame ===")
for e in m["entries"][:4]:
    print(f"  {e['asiId']:<40} min={[round(v,1) for v in e['bounds']['min']]} max={[round(v,1) for v in e['bounds']['max']]}")
