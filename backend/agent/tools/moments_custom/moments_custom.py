"""Handle user-authored Moments text without inventing product requirements.

The personal Weixin iLink channel is a chat transport, not a Moments publisher.
This tool deliberately has no network or desktop side effects and cannot return
a publication receipt. A future publisher must be a separate, verified adapter.
"""

from __future__ import annotations

from typing import Any, Dict, Mapping

from agent.tools.base_tool import BaseTool, ToolResult


class MomentsCustom(BaseTool):
    name = "moments_custom"
    description = (
        "接收用户自己写好的朋友圈正文，原文返回，不查询产品 SKU 或运营简报，也不自动改写。"
        "当前个人微信 iLink 通道无法发布朋友圈；本工具不调用发布接口，不能报告发布成功。"
    )
    params = {
        "type": "object",
        "properties": {
            "body": {"type": "string", "description": "用户自己提供的完整朋友圈正文。"},
            "action": {"type": "string", "enum": ["help"], "description": "展示资料模式和自定义模式的用法。"},
        },
        "anyOf": [{"required": ["body"]}, {"required": ["action"]}],
        "additionalProperties": False,
    }

    def execute(self, args: Dict[str, Any]) -> ToolResult:
        if isinstance(args, Mapping) and dict(args) == {"action": "help"}:
            return ToolResult.success({
                "mode": "help",
                "modes": ["资料模式", "自定义模式"],
                "publicationStatus": "not_published_transport_unavailable",
            })
        if not isinstance(args, Mapping) or set(args) != {"body"}:
            return ToolResult.fail("请发送“发朋友圈 内容：你写好的正文”；本模式不需要 SKU 或运营简报。")
        raw = args["body"]
        if not isinstance(raw, str) or not raw.strip():
            return ToolResult.fail("请把要发的原文放进“自定义模式(内容)”的括号里。")
        body = raw
        return ToolResult.success({
            "body": body,
            "source": "user_authored",
            "publicationStatus": "not_published_transport_unavailable",
            "notice": "已接收原文；当前个人微信 iLink 仅提供聊天收发，未执行朋友圈发布。",
        })
