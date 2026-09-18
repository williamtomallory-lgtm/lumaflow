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
        },
        "required": ["body"],
        "additionalProperties": False,
    }

    def execute(self, args: Dict[str, Any]) -> ToolResult:
        if not isinstance(args, Mapping) or set(args) != {"body"}:
            return ToolResult.fail("请发送“发朋友圈 内容：你写好的正文”；本模式不需要 SKU 或运营简报。")
        raw = args["body"]
        if not isinstance(raw, str) or not raw.strip():
            return ToolResult.fail("请在“内容：”后填写要发的正文；本模式不需要 SKU 或运营简报。")
        body = raw.strip()
        if len(body) > 2000 or any(ord(char) < 32 and char not in "\n\r\t" for char in body):
            return ToolResult.fail("正文过长或包含控制字符；请发送 2000 字以内的纯文本。")
        return ToolResult.success({
            "body": body,
            "source": "user_authored",
            "publicationStatus": "not_published_transport_unavailable",
            "notice": "已接收原文；当前个人微信 iLink 仅提供聊天收发，未执行朋友圈发布。",
        })
