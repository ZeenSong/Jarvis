"""Pinned Pydantic AI adapter: preserve DeepSeek's explicit chat usage fields."""
from pydantic_ai.models.openai import OpenAIChatModel, OpenAIStreamedResponse
from pydantic_ai.usage import RequestUsage


def chat_usage(response):
    value = response.usage
    if value is None:
        return RequestUsage()
    details = value.completion_tokens_details
    return RequestUsage(
        input_tokens=value.prompt_tokens,
        output_tokens=value.completion_tokens,
        cache_read_tokens=getattr(value, 'prompt_cache_hit_tokens', 0) or 0,
        details={'reasoning_tokens': getattr(details, 'reasoning_tokens', 0) or 0},
    )


class DeepSeekStream(OpenAIStreamedResponse):
    def _map_usage(self, response):
        return chat_usage(response)


class DeepSeekChatModel(OpenAIChatModel):
    # genai-prices extraction can select the wrong schema when token detail
    # objects are present. Map the documented chat fields without price inference.
    @property
    def _streamed_response_cls(self):
        return DeepSeekStream

    def _process_response(self, response):
        result = super()._process_response(response)
        result.usage = chat_usage(response)
        return result
