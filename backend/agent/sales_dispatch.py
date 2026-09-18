"""Deterministic sales actions for narrowly recognisable user requests.

Small local models may invoke the correct tool and then rewrite its numbers
incorrectly. For statistics and source-backed Moments drafts, the final result
is therefore formatted from the tool output itself. Other questions continue
through the normal LLM loop; no file content is treated as an instruction.
"""

from __future__ import annotations

import re
from typing import Any, Mapping, NamedTuple, Optional, Sequence


class SalesDispatch(NamedTuple):
    tool_name: str
    arguments: dict
    tool_result: Any
    response: str


def _source_lines(sources: Any) -> str:
    if not isinstance(sources, list) or not sources:
        return "来源文件未返回。"
    labels = []
    for item in sources:
        if not isinstance(item, Mapping):
            continue
        file_name = str(item.get("fileName") or "未命名文件")
        collection = "隔离虚构演示资料" if item.get("collection") == "demo" else "网站授权上传资料"
        labels.append(f"《{file_name}》（{collection}）")
    return "、".join(labels) if labels else "来源文件未返回。"


def _statistics_response(data: Mapping[str, Any]) -> str:
    metrics = data.get("metrics")
    if not isinstance(metrics, Mapping):
        return "销售统计工具没有返回有效指标；不会猜测经营数据。"
    percent = metrics.get("developmentToWonPercent")
    conversion = "无新开发客户，转化率不可计算" if percent is None else f"{percent}%"
    won_ids = data.get("wonCustomerIds")
    won_label = "、".join(str(value) for value in won_ids) if isinstance(won_ids, list) and won_ids else "无"
    duplicates = data.get("duplicates")
    skipped = len(duplicates) if isinstance(duplicates, list) else 0
    return (
        "我是 LumaFlow 销售助手。根据当前授权销售结果文件，按客户 ID 去重计算：\n"
        f"- 新开发客户：{metrics.get('newCustomerCount')}\n"
        f"- 已报价客户：{metrics.get('quotedCustomerCount')}\n"
        f"- 成交客户：{metrics.get('wonCustomerCount')}（{won_label}）\n"
        f"- 成交金额：{metrics.get('wonAmount')} 元\n"
        f"- 开发到成交转化率：{conversion}\n"
        f"- 表格内完全重复记录跳过：{skipped} 条；叙述性备注不作额外记录，冲突记录不会合并。\n"
        f"来源：{_source_lines(data.get('sources'))}。缺失毛利、成本或退款数据时不估计。"
    )


def _moments_response(data: Mapping[str, Any]) -> str:
    body = data.get("body")
    if not isinstance(body, str) or not body:
        return "朋友圈草稿工具没有返回可用正文；不会自行补写产品事实。"
    image_brief = str(data.get("imageBrief") or "暂无可核对的配图需求")
    return (
        f"【正文】\n{body}\n\n"
        f"【配图建议】\n{image_brief}（这里只给建议，尚未生成图片。）\n\n"
        f"【发布核对】\n来源：{_source_lines(data.get('sources'))}。"
        "内容为草稿，未发布朋友圈；演示资料不得用于真实销售宣传。"
    )


def _requested_tool(message: str) -> Optional[tuple[str, dict]]:
    compact = re.sub(r"\s+", "", message or "")
    # An edit of the user's own copy is a creative conversation, not a
    # template regeneration. Keep it in the LLM loop for that distinction.
    if "朋友圈" in compact and any(word in compact for word in ("文案", "草稿", "重新生成", "运营简报")):
        if any(word in compact for word in ("我写的", "自己写的", "按我修改", "编辑我")):
            return None
        variant = 3 if any(word in compact for word in ("第三版", "第3版", "variant=3")) else 2 if any(
            word in compact for word in ("第二版", "第2版", "variant=2", "重新生成")
        ) else 1
        return "moments_draft", {"variant": variant}
    if (
        ("销售结果" in compact or "开发到成交转化率" in compact)
        and any(word in compact for word in ("统计", "计算", "去重", "客户数", "成交金额", "转化率"))
    ):
        return "sales_statistics", {}
    return None


def try_sales_dispatch(message: str, tools: Sequence[Any]) -> Optional[SalesDispatch]:
    choice = _requested_tool(message)
    if choice is None:
        return None
    tool_name, arguments = choice
    tool = next((item for item in tools if getattr(item, "name", None) == tool_name), None)
    try:
        available = tool is not None and tool.is_available()
    except Exception:
        available = False
    if not available:
        return SalesDispatch(tool_name, arguments, None, "当前网站知识桥接尚未就绪；无法核对授权文件，不会编造结果。")
    try:
        result = tool.execute(arguments)
    except Exception:
        return SalesDispatch(tool_name, arguments, None, "授权资料工具执行失败；不会编造结果，请检查本机服务。")
    if result.status != "success":
        return SalesDispatch(tool_name, arguments, result, f"无法根据当前授权文件完成请求：{result.result}")
    data = result.result
    if not isinstance(data, Mapping):
        return SalesDispatch(tool_name, arguments, result, "工具返回格式无效；不会猜测产品或销售数据。")
    response = _statistics_response(data) if tool_name == "sales_statistics" else _moments_response(data)
    return SalesDispatch(tool_name, arguments, result, response)
