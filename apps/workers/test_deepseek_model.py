import unittest
from openai.types.chat import ChatCompletionChunk
from deepseek_model import chat_usage


class UsageMappingTest(unittest.TestCase):
    def test_deepseek_details_do_not_erase_billable_tokens(self):
        chunk = ChatCompletionChunk(
            id='test', created=0, model='deepseek-v4-flash',
            object='chat.completion.chunk', choices=[],
            usage={'prompt_tokens': 85, 'completion_tokens': 17, 'total_tokens': 102,
                   'prompt_cache_hit_tokens': 64,
                   'prompt_tokens_details': {'cached_tokens': 64, 'audio_tokens': None},
                   'completion_tokens_details': {'reasoning_tokens': 15}},
        )
        usage = chat_usage(chunk)
        self.assertEqual((usage.input_tokens, usage.output_tokens, usage.cache_read_tokens), (85, 17, 64))
        self.assertEqual(usage.details['reasoning_tokens'], 15)


if __name__ == '__main__':
    unittest.main()
