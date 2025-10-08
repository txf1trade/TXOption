from flask import Flask, request, jsonify, render_template, session
from collections import defaultdict
from datetime import datetime
import shioaji
import os

app = Flask(__name__)
app.secret_key = os.urandom(24)  # session 用

api_instance = None  # 全域保存 api 物件
tx_data = {}         # 全域選擇權資料結構 (series -> strike_map)，由 /get_options 填入

# ===============================
# 首頁
# ===============================
@app.route("/")
def index():
    return render_template("index.html")

# ===============================
# 登入
# ===============================
@app.route("/login", methods=["POST"])
def login():
    global api_instance
    data = request.json
    api_key = data.get("apiKey")
    secret_key = data.get("secretKey")
    use_ca = data.get("useCa", False)
    ca_id = data.get("caId")
    ca_pwd = data.get("caPwd")

    if not api_key or not secret_key:
        return jsonify({"success": False, "message": "API Key 與 Secret Key 必填"})

    if use_ca and (not ca_id or not ca_pwd):
        return jsonify({"success": False, "message": "CA 資訊必填"})

    try:
        api = shioaji.Shioaji()
        api.login(api_key, secret_key)
        api_instance = api

        ca_status = "未啟用"
        if use_ca:
            try:
                ca_path = os.path.join(os.path.dirname(__file__), "Sinopac.pfx")
                api.activate_ca(ca_path=ca_path, ca_passwd=ca_pwd, person_id=ca_id)
                ca_status = "CA 啟用成功"
            except Exception:
                ca_status = "CA 未啟用/錯誤"

        account_id = "未知帳號"
        try:
            if api.futopt_account and api.futopt_account.account_id:
                account_id = api.futopt_account.account_id
            elif api.stock_account and api.stock_account.account_id:
                account_id = api.stock_account.account_id
        except Exception:
            pass

        session["logged_in"] = True
        session["person_id"] = account_id
        session["ca_status"] = ca_status

        return jsonify({"success": True, "person_id": account_id, "ca_status": ca_status})
    except Exception as e:
        return jsonify({"success": False, "message": str(e)})

# ===============================
# 流量查詢
# ===============================
@app.route("/usage")
def usage():
    global api_instance
    if not session.get("logged_in", False) or not api_instance:
        return jsonify({"used": 0, "limit": 0, "unit": "MB", "logged_in": False})

    try:
        u = api_instance.usage()
        used = getattr(u, "bytes", 0)
        limit = getattr(u, "limit_bytes", 0)
        if limit >= 1_000_000_000:
            unit = "GB"
            used_val = round(used / 1e9, 2)
            limit_val = round(limit / 1e9, 2)
        else:
            unit = "MB"
            used_val = round(used / 1e6, 2)
            limit_val = round(limit / 1e6, 2)
        return jsonify({"used": used_val, "limit": limit_val, "unit": unit, "logged_in": True})
    except Exception as e:
        print("usage error:", e)
        return jsonify({"used": 0, "limit": 0, "unit": "MB", "logged_in": True})


# ===============================
# 取得行情資料
# ===============================
@app.route("/get_market_data")
def get_market_data():
    global api_instance
    if not session.get("logged_in", False) or not api_instance:
        return jsonify({"txf_price": "-", "txf_total_volume": "-", "twii": "-", "otc": "-", "change_price": "-", "logged_in": False})
    
    result = {"txf_price": "-", "txf_total_volume": "-", "twii": "-", "otc": "-", "change_price": "-"}
    
    try:
        api = api_instance

        fut_contract = api.Contracts.Futures.TXF.TXFR1
        fut_snap = api.snapshots([fut_contract])
        if fut_snap:
            tick = fut_snap[0]
            result["txf_price"] = tick.close if tick.close is not None else "-"
            result["change_price"] = tick.change_price if tick.change_price is not None else "-"
            result["txf_total_volume"] = tick.total_volume if tick.total_volume is not None else "-"

        tse_contract = api.Contracts.Indexs.TSE.TSE001
        tse_snap = api.snapshots([tse_contract])
        if tse_snap and tse_snap[0].close is not None:
            result["twii"] = tse_snap[0].close

        otc_contract = api.Contracts.Indexs.OTC.OTC101
        otc_snap = api.snapshots([otc_contract])
        if otc_snap and otc_snap[0].close is not None:
            result["otc"] = otc_snap[0].close

        result["logged_in"] = True
    except Exception as e:
        print("get_market_data error:", e)
        result["logged_in"] = True

    return jsonify(result)


# ===============================
# 取得選擇權系列
# ===============================
@app.route("/get_options")
def get_options():
    global api_instance, tx_data
    if not session.get("logged_in", False) or not api_instance:
        return jsonify({"success": False, "message": "尚未登入", "tx_series_list": [], "default_series": None, "logged_in": False})
        
    try:
        tx_data_local = {}
        tx_series_with_days = []
        
        # 抓取所有 TX 系列合約
        tx_series_list = [k for k in dir(api_instance.Contracts.Options) if k.startswith("TX")]
        
        for series in tx_series_list:
            contracts = api_instance.Contracts.Options[series]
                        
            if not contracts:
                continue

            # 建立 strike_map
            strike_map = defaultdict(dict)
            for c in contracts:
                try:
                    strike_map[int(c.strike_price)][c.option_right.value] = c
                except Exception:
                    # 若 strike_price 轉換失敗，跳過該合約
                    continue
                
            tx_data_local[series] = strike_map

            # 計算到期日與剩餘天數
            delivery_dates = [c.delivery_date for c in contracts if getattr(c, "delivery_date", None)]
            
            if not delivery_dates:
                continue
            delivery_dates.sort()
            next_delivery = delivery_dates[0]
            try:
                days_left = (datetime.strptime(next_delivery, "%Y/%m/%d").date() - datetime.now().date()).days
            except Exception:
                days_left = None

            # 判斷週/月選（簡單判斷）
            series_type = "周選"
            if series.endswith("O"):
                series_type = "月選"
            elif series[-1].isdigit():
                series_type = "周選"

            tx_series_with_days.append({
                "series": series,
                "days_left": days_left if days_left is not None else -1,
                "type": series_type
            })

        # 儲存在全域 tx_data 供 /snapshot 使用
        tx_data = tx_data_local

        # 篩選未結算合約
        positive_days_series = [x for x in tx_series_with_days if x["days_left"] >= 0]
        # 按剩餘天數從小到大排序
        positive_days_series.sort(key=lambda x: x["days_left"])
        # 預設選最近到期的合約
        default_series = positive_days_series[0]["series"] if positive_days_series else None
        
        return jsonify({
            "success": True,
            "tx_series_list": positive_days_series,
            "default_series": default_series
        })

    except Exception as e:
        return jsonify({"success": False, "message": str(e)})


# =======================================
# 取得選擇權即時快照
# =======================================
@app.route("/snapshot")
def snapshot():
    global api_instance, tx_data
    if not session.get('logged_in', False) or not api_instance:
        return jsonify({"rows": [], "min_strike": None, "min_value": None, "max_t_strike": None})

    series = request.args.get("series")
    order  = request.args.get("order", "desc")

    if not series or series not in tx_data:
        return jsonify({"rows": [], "min_strike": None, "min_value": None, "max_t_strike": None})

    strike_map = tx_data[series]
    all_contracts = []
    strike_keys = sorted(strike_map.keys(), reverse=(order=="desc"))

    try:
        for s in strike_keys:
            if 'C' in strike_map[s]:
                all_contracts.append(strike_map[s]['C'])
            if 'P' in strike_map[s]:
                all_contracts.append(strike_map[s]['P'])

        snaps = api_instance.snapshots(all_contracts)
    except Exception as e:
        print("snapshot error getting snapshots:", e)
        return jsonify({"rows": [], "min_strike": None, "min_value": None, "max_t_strike": None})

    result = []
    idx = 0
    try:
        for s in strike_keys:
            call_price = "-"
            put_price  = "-"
            call_volume = "-"
            put_volume = "-"

            if 'C' in strike_map[s]:
                if idx < len(snaps):
                    cp_snap = snaps[idx]
                    call_price = cp_snap.close if cp_snap.close not in (None,0) else "-"
                    call_volume = cp_snap.total_volume if cp_snap.total_volume not in (None,0) else "-"
                idx += 1

            if 'P' in strike_map[s]:
                if idx < len(snaps):
                    pp_snap = snaps[idx]
                    put_price = pp_snap.close if pp_snap.close not in (None,0) else "-"
                    put_volume = pp_snap.total_volume if pp_snap.total_volume not in (None,0) else "-"
                idx += 1

            atm_sum = None
            t_value = None
            ws_value = None
            if call_price != "-" and put_price != "-":
                try:
                    atm_sum = float(call_price) + float(put_price)
                    t_value = min(float(call_price), float(put_price))
                    ws_value = int(s + float(call_price) - float(put_price))
                except Exception:
                    atm_sum = None
                    t_value = None
                    ws_value = None

            result.append({
                "strike": s,
                "call_price": call_price,
                "call_volume": call_volume,
                "put_price": put_price,
                "put_volume": put_volume,
                "atm_sum": atm_sum,
                "t_value": t_value,
                "week_small": ws_value
            })

        valid_rows = [r for r in result if r["atm_sum"] is not None]
        min_row = min(valid_rows, key=lambda x: x["atm_sum"]) if valid_rows else None
        valid_t_rows = [r for r in result if r["t_value"] is not None]
        max_t_row = max(valid_t_rows, key=lambda x: x["t_value"]) if valid_t_rows else None

        return jsonify({
            "rows": result,
            "min_strike": min_row["strike"] if min_row else None,
            "min_value":  min_row["atm_sum"] if min_row else None,
            "max_t_strike": max_t_row["strike"] if max_t_row else None
        })
    except Exception as e:
        print("snapshot processing error:", e)
        return jsonify({"rows": [], "min_strike": None, "min_value": None, "max_t_strike": None})


# ===============================
# 登出
# ===============================
@app.route("/logout")
def logout():
    global api_instance, tx_data
    session.clear()
    api_instance = None
    tx_data = {}
    return jsonify({"success": True, 
                    "txf_price": "-", "txf_total_volume": "-", "twii": "-", "otc": "-", "change_price": "-", 
                    "tx_series_list": [], "default_series": None})

# ===============================
# 啟動 Flask
# ===============================
if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    app.run(host="0.0.0.0", port=port, debug=True)
