"""Staging-only own-profile real file lifecycle and exact byte/Storage cleanup."""
import argparse
from test_hosted_business_journeys import run

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    group = parser.add_mutually_exclusive_group()
    group.add_argument('--execute', action='store_true')
    group.add_argument('--recover', action='store_true')
    args = parser.parse_args()
    run(args.execute, args.recover, web=True, media_mode=True)
