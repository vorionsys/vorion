// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';

// Mock next/link
vi.mock('next/link', () => ({
  default: ({ href, children, className }: {
    href: string;
    children: React.ReactNode;
    className?: string;
  }) => (
    <a href={href} className={className}>
      {children}
    </a>
  ),
}));

import { Quiz } from '../quiz/Quiz';
import type { Quiz as QuizType, QuizAttempt } from '@/types';

const mockQuiz: QuizType = {
  id: 'quiz-1',
  title: 'Agent Fundamentals',
  description: 'Test your knowledge of AI agent concepts.',
  questions: [
    {
      id: 'q1',
      termName: 'Agent',
      type: 'multiple-choice',
      question: 'What is an AI agent?',
      options: [
        { id: 'q1a', text: 'A software entity that acts autonomously', isCorrect: true },
        { id: 'q1b', text: 'A static web page', isCorrect: false },
        { id: 'q1c', text: 'A database query', isCorrect: false },
        { id: 'q1d', text: 'A CSS framework', isCorrect: false },
      ],
      explanation: 'An AI agent is a software entity that perceives its environment and acts autonomously.',
      difficulty: 'beginner',
    },
    {
      id: 'q2',
      termName: 'Multi-Agent System',
      type: 'multiple-choice',
      question: 'What defines a multi-agent system?',
      options: [
        { id: 'q2a', text: 'A single monolithic program', isCorrect: false },
        { id: 'q2b', text: 'Multiple agents interacting in a shared environment', isCorrect: true },
        { id: 'q2c', text: 'A database with multiple tables', isCorrect: false },
        { id: 'q2d', text: 'A web server cluster', isCorrect: false },
      ],
      explanation: 'Multi-agent systems involve multiple autonomous agents interacting in a shared environment.',
      difficulty: 'beginner',
    },
  ],
  passingScore: 50,
  timeLimit: 5,
};

describe('Quiz', () => {
  describe('Intro Screen', () => {
    it('renders the quiz title', () => {
      render(<Quiz quiz={mockQuiz} />);
      expect(screen.getByText('Agent Fundamentals')).toBeInTheDocument();
    });

    it('renders the quiz description', () => {
      render(<Quiz quiz={mockQuiz} />);
      expect(screen.getByText('Test your knowledge of AI agent concepts.')).toBeInTheDocument();
    });

    it('shows the number of questions', () => {
      render(<Quiz quiz={mockQuiz} />);
      expect(screen.getByText('2')).toBeInTheDocument();
      expect(screen.getByText('questions')).toBeInTheDocument();
    });

    it('shows the passing score', () => {
      render(<Quiz quiz={mockQuiz} />);
      expect(screen.getByText('50%')).toBeInTheDocument();
      expect(screen.getByText('to pass')).toBeInTheDocument();
    });

    it('shows the time limit when set', () => {
      render(<Quiz quiz={mockQuiz} />);
      expect(screen.getByText('5')).toBeInTheDocument();
      expect(screen.getByText('min limit')).toBeInTheDocument();
    });

    it('renders the Start Quiz button', () => {
      render(<Quiz quiz={mockQuiz} />);
      expect(screen.getByText('Start Quiz')).toBeInTheDocument();
    });
  });

  describe('Active Quiz', () => {
    it('transitions to active state on Start Quiz click', () => {
      render(<Quiz quiz={mockQuiz} />);
      fireEvent.click(screen.getByText('Start Quiz'));
      expect(screen.getByText('Question 1 of 2')).toBeInTheDocument();
    });

    it('displays the first question', () => {
      render(<Quiz quiz={mockQuiz} />);
      fireEvent.click(screen.getByText('Start Quiz'));
      expect(screen.getByText('What is an AI agent?')).toBeInTheDocument();
    });

    it('shows the term name above the question', () => {
      render(<Quiz quiz={mockQuiz} />);
      fireEvent.click(screen.getByText('Start Quiz'));
      expect(screen.getByText('Agent')).toBeInTheDocument();
    });

    it('renders all answer options', () => {
      render(<Quiz quiz={mockQuiz} />);
      fireEvent.click(screen.getByText('Start Quiz'));
      expect(screen.getByText('A software entity that acts autonomously')).toBeInTheDocument();
      expect(screen.getByText('A static web page')).toBeInTheDocument();
      expect(screen.getByText('A database query')).toBeInTheDocument();
      expect(screen.getByText('A CSS framework')).toBeInTheDocument();
    });

    it('shows explanation after selecting an answer', () => {
      render(<Quiz quiz={mockQuiz} />);
      fireEvent.click(screen.getByText('Start Quiz'));
      fireEvent.click(screen.getByText('A software entity that acts autonomously'));
      expect(screen.getByText(/An AI agent is a software entity/)).toBeInTheDocument();
    });

    it('shows Next Question button after answering', () => {
      render(<Quiz quiz={mockQuiz} />);
      fireEvent.click(screen.getByText('Start Quiz'));
      fireEvent.click(screen.getByText('A software entity that acts autonomously'));
      expect(screen.getByText('Next Question')).toBeInTheDocument();
    });

    it('shows See Results on the last question', () => {
      render(<Quiz quiz={mockQuiz} />);
      fireEvent.click(screen.getByText('Start Quiz'));
      // Answer Q1
      fireEvent.click(screen.getByText('A software entity that acts autonomously'));
      fireEvent.click(screen.getByText('Next Question'));
      // Answer Q2 — now on last question
      fireEvent.click(screen.getByText('Multiple agents interacting in a shared environment'));
      expect(screen.getByText('See Results')).toBeInTheDocument();
    });
  });

  describe('Results Screen', () => {
    function completeQuizWithCorrectAnswers() {
      render(<Quiz quiz={mockQuiz} />);
      fireEvent.click(screen.getByText('Start Quiz'));
      // Q1 correct
      fireEvent.click(screen.getByText('A software entity that acts autonomously'));
      fireEvent.click(screen.getByText('Next Question'));
      // Q2 correct
      fireEvent.click(screen.getByText('Multiple agents interacting in a shared environment'));
      fireEvent.click(screen.getByText('See Results'));
    }

    it('shows score after completing the quiz', () => {
      completeQuizWithCorrectAnswers();
      expect(screen.getByText('100%')).toBeInTheDocument();
    });

    it('shows Congratulations when passed', () => {
      completeQuizWithCorrectAnswers();
      expect(screen.getByText('Congratulations!')).toBeInTheDocument();
    });

    it('shows correct count', () => {
      completeQuizWithCorrectAnswers();
      expect(screen.getByText('2 of 2 correct')).toBeInTheDocument();
    });

    it('shows Review Answers button', () => {
      completeQuizWithCorrectAnswers();
      expect(screen.getByText('Review Answers')).toBeInTheDocument();
    });

    it('shows Try Again button', () => {
      completeQuizWithCorrectAnswers();
      expect(screen.getByText('Try Again')).toBeInTheDocument();
    });

    it('shows Keep Learning for failed quiz', () => {
      render(<Quiz quiz={mockQuiz} />);
      fireEvent.click(screen.getByText('Start Quiz'));
      // Q1 wrong
      fireEvent.click(screen.getByText('A static web page'));
      fireEvent.click(screen.getByText('Next Question'));
      // Q2 wrong
      fireEvent.click(screen.getByText('A single monolithic program'));
      fireEvent.click(screen.getByText('See Results'));
      expect(screen.getByText('Keep Learning!')).toBeInTheDocument();
    });
  });

  describe('Callbacks', () => {
    it('calls onComplete when quiz is finished', () => {
      const onComplete = vi.fn();
      render(<Quiz quiz={mockQuiz} onComplete={onComplete} />);
      fireEvent.click(screen.getByText('Start Quiz'));
      fireEvent.click(screen.getByText('A software entity that acts autonomously'));
      fireEvent.click(screen.getByText('Next Question'));
      fireEvent.click(screen.getByText('Multiple agents interacting in a shared environment'));
      fireEvent.click(screen.getByText('See Results'));
      expect(onComplete).toHaveBeenCalledTimes(1);
      const attempt: QuizAttempt = onComplete.mock.calls[0][0];
      expect(attempt.quizId).toBe('quiz-1');
      expect(attempt.score).toBe(100);
      expect(attempt.passed).toBe(true);
    });

    it('calls onRetry when Try Again is clicked', () => {
      const onRetry = vi.fn();
      render(<Quiz quiz={mockQuiz} onRetry={onRetry} />);
      // Complete quiz first
      fireEvent.click(screen.getByText('Start Quiz'));
      fireEvent.click(screen.getByText('A software entity that acts autonomously'));
      fireEvent.click(screen.getByText('Next Question'));
      fireEvent.click(screen.getByText('Multiple agents interacting in a shared environment'));
      fireEvent.click(screen.getByText('See Results'));
      // Click retry
      fireEvent.click(screen.getByText('Try Again'));
      expect(onRetry).toHaveBeenCalledTimes(1);
    });
  });
});
