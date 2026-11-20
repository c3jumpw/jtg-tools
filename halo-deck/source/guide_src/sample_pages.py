"""Two made-up web app screens (a fictional company) used as the pictures being annotated in the screenshots."""

DASHBOARD = """<!doctype html><html><head><meta charset="utf-8"><style>
*{box-sizing:border-box} body{margin:0;width:1600px;height:900px;font:15px/1.4 'DejaVu Sans',Arial,sans-serif;color:#1d2433;background:#f3f5f8;display:flex}
.side{width:230px;background:#16213a;color:#c8d0e0;padding:26px 18px;display:flex;flex-direction:column;gap:6px}
.logo{color:#fff;font-weight:700;font-size:19px;margin-bottom:22px;display:flex;gap:10px;align-items:center}
.logo i{width:26px;height:26px;border-radius:7px;background:#4f8df7;display:block}
.nav{padding:10px 12px;border-radius:8px}.nav.on{background:#24345a;color:#fff}
main{flex:1;padding:28px 34px;display:flex;flex-direction:column;gap:20px}
header{display:flex;align-items:center;justify-content:space-between}
h1{margin:0;font-size:26px} .sub{color:#6b7488;font-size:14px}
.kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:16px}
.kpi{background:#fff;border-radius:12px;padding:18px 20px;box-shadow:0 1px 2px rgba(0,0,0,.06)}
.kpi b{display:block;font-size:28px;margin-top:6px} .kpi span{color:#6b7488;font-size:13px}
.down{color:#d64545;font-size:13px;font-weight:700}
.row{display:grid;grid-template-columns:1.25fr 1fr;gap:16px;flex:1;min-height:0}
.card{background:#fff;border-radius:12px;padding:18px 20px;box-shadow:0 1px 2px rgba(0,0,0,.06);display:flex;flex-direction:column}
.card h2{margin:0 0 14px;font-size:16px}
.chart{flex:1;display:flex;align-items:flex-end;gap:16px;padding:0 6px;border-bottom:1px solid #dde2ea}
.bar{flex:1;background:#4f8df7;border-radius:6px 6px 0 0;position:relative}
.bar.low{background:#f08a3c}
.bar em{position:absolute;top:-22px;left:0;right:0;text-align:center;font-style:normal;font-size:12px;color:#6b7488}
.wk{display:flex;gap:16px;padding:6px 6px 0}.wk span{flex:1;text-align:center;font-size:12px;color:#6b7488}
table{width:100%;border-collapse:collapse;font-size:14px} th{text-align:left;color:#6b7488;font-weight:600;font-size:12px;padding:8px 6px;border-bottom:1px solid #e3e7ee}
td{padding:11px 6px;border-bottom:1px solid #eef1f5} .pill{padding:3px 9px;border-radius:999px;font-size:12px;font-weight:700}
.ok{background:#e3f4ea;color:#21804a}.warn{background:#fdeedd;color:#b35a12}.bad{background:#fbe1e1;color:#b42a2a}
</style></head><body>
<div class="side"><div class="logo"><i></i>Larkspur Supply</div>
<div class="nav on">Inventory</div><div class="nav">Orders</div><div class="nav">Suppliers</div><div class="nav">Reports</div><div class="nav">Settings</div></div>
<main>
<header><div><h1>Inventory overview</h1><div class="sub">Week 42 · all warehouses</div></div><div class="sub">Updated 9:40 AM</div></header>
<div class="kpis">
<div class="kpi"><span>Units in stock</span><b>18,240</b></div>
<div class="kpi"><span>Low-stock items</span><b>37</b></div>
<div class="kpi" id="kpi-orders"><span>Orders this week</span><b>1,330</b><span class="down">▼ 38% vs last week</span></div>
<div class="kpi"><span>Avg. fulfilment</span><b>1.8 days</b></div>
</div>
<div class="row">
<div class="card"><h2>Orders per week</h2>
<div class="chart">
<div class="bar" style="height:62%"><em>1,940</em></div><div class="bar" style="height:70%"><em>2,050</em></div><div class="bar" style="height:66%"><em>1,990</em></div>
<div class="bar" style="height:74%"><em>2,140</em></div><div class="bar low" id="dropbar" style="height:44%"><em>1,330</em></div><div class="bar" style="height:47%"><em>1,410</em></div>
</div>
<div class="wk"><span>W37</span><span>W38</span><span>W39</span><span>W40</span><span>W41</span><span>W42</span></div>
</div>
<div class="card"><h2>Stock alerts</h2>
<table><tr><th>SKU</th><th>Item</th><th>On hand</th><th>Status</th></tr>
<tr><td>SKU-1180</td><td>Linen apron</td><td>214</td><td><span class="pill ok">OK</span></td></tr>
<tr><td>SKU-1733</td><td>Oak serving board</td><td>41</td><td><span class="pill warn">Low</span></td></tr>
<tr id="badrow"><td>SKU-2041</td><td>Ceramic mug, 12 oz</td><td>0</td><td><span class="pill bad">Out</span></td></tr>
<tr><td>SKU-2210</td><td>Glass carafe</td><td>96</td><td><span class="pill ok">OK</span></td></tr>
<tr><td>SKU-2302</td><td>Cotton napkins (4)</td><td>18</td><td><span class="pill warn">Low</span></td></tr>
</table></div>
</div>
</main></body></html>"""

SETTINGS = """<!doctype html><html><head><meta charset="utf-8"><style>
*{box-sizing:border-box} body{margin:0;width:1600px;height:900px;font:15px/1.4 'DejaVu Sans',Arial,sans-serif;color:#1d2433;background:#f3f5f8;display:flex}
.side{width:230px;background:#16213a;color:#c8d0e0;padding:26px 18px;display:flex;flex-direction:column;gap:6px}
.logo{color:#fff;font-weight:700;font-size:19px;margin-bottom:22px;display:flex;gap:10px;align-items:center}
.logo i{width:26px;height:26px;border-radius:7px;background:#4f8df7;display:block}
.nav{padding:10px 12px;border-radius:8px}.nav.on{background:#24345a;color:#fff}
main{flex:1;padding:28px 34px;display:flex;flex-direction:column;gap:20px}
h1{margin:0;font-size:26px}.sub{color:#6b7488;font-size:14px}
.card{background:#fff;border-radius:12px;padding:8px 24px;box-shadow:0 1px 2px rgba(0,0,0,.06);max-width:980px}
.set{display:flex;align-items:center;justify-content:space-between;padding:20px 0;border-bottom:1px solid #eef1f5}
.set:last-child{border-bottom:0}.set b{display:block;font-size:16px}.set span{color:#6b7488;font-size:14px}
.tog{width:52px;height:30px;border-radius:999px;background:#cfd6e2;position:relative;flex:0 0 auto}
.tog::after{content:"";position:absolute;top:3px;left:3px;width:24px;height:24px;border-radius:50%;background:#fff}
.tog.on{background:#4f8df7}.tog.on::after{left:25px}
</style></head><body>
<div class="side"><div class="logo"><i></i>Larkspur Supply</div>
<div class="nav">Inventory</div><div class="nav">Orders</div><div class="nav">Suppliers</div><div class="nav">Reports</div><div class="nav on">Settings</div></div>
<main><div><h1>Import settings</h1><div class="sub">Applies to every supplier price file</div></div>
<div class="card">
<div class="set"><div><b>Match items by SKU</b><span>Link rows in the file to items that already exist</span></div><div class="tog on"></div></div>
<div class="set" id="riskset"><div><b>Overwrite prices automatically</b><span>New prices go live as soon as the file is imported</span></div><div class="tog on" id="risktog"></div></div>
<div class="set"><div><b>Email a summary</b><span>Send the import report to the purchasing team</span></div><div class="tog on"></div></div>
<div class="set"><div><b>Keep a copy of each file</b><span>Store the original file for 90 days</span></div><div class="tog"></div></div>
</div></main></body></html>"""
