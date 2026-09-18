import os
import shutil
import subprocess
import tempfile
import time
import unittest
from pathlib import Path

from routes.terminal_scroll import parse_state, scroll_script
from terminal_prompt_context import prompt_context


class PromptContextTest(unittest.TestCase):
    def test_selects_question_before_top_not_the_latest_or_next_visible_question(self):
        lines = ['preamble', '› 질문 A', '', 'answer A', 'answer A', '❯ 질문 B', '  둘째 줄', '',
                 'answer B', '› 질문 C', '', 'answer C']
        for top, text in [(0, None), (3, '질문 A'), (4, '질문 A'), (5, '질문 B\n둘째 줄'),
                          (8, '질문 B\n둘째 줄'), (11, '질문 C')]:
            with self.subTest(top=top):
                self.assertEqual(prompt_context(lines, top), {'text': text} if text else None)

    def test_shell_examples_and_markdown_quotes_are_not_questions(self):
        self.assertIsNone(prompt_context(['$ echo example', '> blockquote', 'output'], 2))

    def test_missing_or_truncated_history_has_no_guessed_question(self):
        self.assertIsNone(prompt_context(['answer without its question'], 0))
        self.assertIsNone(prompt_context(['› old question'], 100))

    def test_a_viewport_change_during_capture_discards_context(self):
        out = '%1|100|30|20|copy-mode\nCONTEXT:3\n› A\n\nanswer\nCONTEXT-END:%1|100|40|20|copy-mode'
        self.assertIsNone(parse_state(out, True)['input_context'])


@unittest.skipUnless(shutil.which('tmux'), 'tmux required')
class TmuxPromptContextTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.base = ['tmux', '-L', f'prompt-context-test-{os.getpid()}']
        cls.env = {k: v for k, v in os.environ.items() if k not in ('TMUX', 'TMUX_PANE')}
        cls.tmp = tempfile.TemporaryDirectory()
        cls.question_a = '첫 질문 ' + '한글 띄어쓰기 ' * 20
        transcript = []
        for question, letter in [(cls.question_a, 'A'), ('두 번째 질문\n  여러 줄 입력', 'B'), ('세 번째 질문', 'C')]:
            transcript += ['› ' + question, '', *[f'answer {letter} {i}' for i in range(45)], '']
        fixture = Path(cls.tmp.name) / 'history.txt'
        fixture.write_text('\n'.join(transcript) + '\n')
        cls.run_tmux('-f', '/dev/null', 'new-session', '-d', '-s', 'history', '-x', '50', '-y', '20',
                     f'cat {fixture}; sleep 3600')
        for _ in range(40):
            if cls.history() > 100:
                break
            time.sleep(.025)

    @classmethod
    def tearDownClass(cls):
        subprocess.run([*cls.base, 'kill-server'], env=cls.env, capture_output=True)
        cls.tmp.cleanup()

    @classmethod
    def run_tmux(cls, *args):
        return subprocess.check_output([*cls.base, *args], env=cls.env, text=True, timeout=3)

    @classmethod
    def history(cls):
        return int(cls.run_tmux('display-message', '-p', '-t', 'history', '#{history_size}').strip())

    def context(self, offset=None):
        out = subprocess.check_output(['sh', '-c', scroll_script(self.base, 'history', offset, True)],
                                      env=self.env, text=True, timeout=3)
        return parse_state(out, True)

    def offset_for(self, answer):
        lines = self.run_tmux('capture-pane', '-p', '-t', 'history', '-S', '-', '-E', '-').splitlines()
        return self.history() - next(i for i, line in enumerate(lines) if line.startswith(answer))

    def test_old_and_new_answers_select_their_own_questions_in_both_directions(self):
        for letter, expected in [('A', self.question_a.rstrip()), ('B', '두 번째 질문\n여러 줄 입력'),
                                 ('C', '세 번째 질문'), ('A', self.question_a.rstrip())]:
            with self.subTest(letter=letter):
                state = self.context(self.offset_for(f'answer {letter} 10'))
                self.assertEqual(state['input_context']['text'], expected)
                self.assertEqual(state['input_context']['offset'], self.offset_for('› ' + expected.split('\n')[0][:8]))
                jumped = self.context(state['input_context']['offset'])
                self.assertEqual(jumped['offset'], state['input_context']['offset'])

    def test_reload_needs_no_new_input_and_bottom_hides_context(self):
        self.context(self.offset_for('answer B 10'))
        self.assertEqual(self.context()['input_context']['text'], '두 번째 질문\n여러 줄 입력')
        self.assertIsNone(self.context(0)['input_context'])

    def test_reflow_uses_real_history_positions(self):
        self.context(0)
        self.run_tmux('resize-window', '-t', 'history', '-x', '35', '-y', '20')
        state = self.context(self.offset_for('answer A 10'))
        self.assertEqual(state['input_context']['text'], self.question_a.rstrip())
        self.assertEqual(state['input_context']['offset'], self.offset_for('› 첫 질문'))

    def test_new_output_does_not_reassign_the_frozen_copy_mode_view(self):
        self.context(self.offset_for('answer B 10'))
        tty = self.run_tmux('display-message', '-p', '-t', 'history', '#{pane_tty}').strip()
        with open(tty, 'w') as stream:
            stream.write('\r\n' + '\r\n'.join(f'new output {i}' for i in range(12)) + '\r\n')
        time.sleep(.05)
        self.assertEqual(self.context()['input_context']['text'], '두 번째 질문\n여러 줄 입력')


if __name__ == '__main__':
    unittest.main()
