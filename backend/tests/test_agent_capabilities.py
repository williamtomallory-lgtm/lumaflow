from types import SimpleNamespace

from agent.capabilities import build_capability_prompt, effective_role_ids


def _profile(**overrides):
    values = {
        "id": "wechat-service",
        "name": "微信客服 Agent",
        "description": "处理客户咨询",
        "agent_type": "weixin_personal",
        "role_ids": None,
    }
    values.update(overrides)
    return SimpleNamespace(**values)


def test_legacy_named_agent_gets_its_matching_role():
    assert effective_role_ids(_profile()) == ("wechat-service",)


def test_composed_roles_are_injected_with_publish_boundary():
    prompt = build_capability_prompt(
        _profile(role_ids=("wechat-service", "sales-review", "moments-operator"))
    )

    assert "微信客服" in prompt
    assert "销售复盘" in prompt
    assert "朋友圈运营" in prompt
    assert "个人微信通道不得声称能自动发布朋友圈" in prompt
    assert "LumaFlow 本机控制台中的明确确认操作" in prompt
