import argparse
import os
from src import data_pipeline, ml_model, agent_engine


def cli():
    parser = argparse.ArgumentParser(description='Chronos - F1 race strategy engine')
    sub = parser.add_subparsers(dest='cmd')

    sub_ingest = sub.add_parser('ingest', help='Ingest a single race')
    sub_ingest.add_argument('--year', default=2024)
    sub_ingest.add_argument('--gp', default='Silverstone')
    sub_ingest.add_argument('--session', default='R')

    sub_ingest_season = sub.add_parser(
        'ingest-season', help='Ingest every completed race across one or more seasons'
    )
    sub_ingest_season.add_argument('--years', nargs='+', type=int, required=True)
    sub_ingest_season.add_argument('--session', default='R')

    sub_train = sub.add_parser('train')

    sub_agent = sub.add_parser('agent')
    sub_agent.add_argument('--prompt', required=True)

    args = parser.parse_args()

    if args.cmd == 'ingest':
        data_pipeline.fetch_and_store_real_f1_data(year=int(args.year), grand_prix=args.gp, session_type=args.session)
    elif args.cmd == 'ingest-season':
        result = data_pipeline.fetch_and_store_season_range(years=args.years, session_type=args.session)
        print(f"Ingested {len(result['succeeded'])} races, {len(result['failed'])} failed/skipped.")
        for f in result['failed']:
            print(f"  SKIPPED: {f['year']} {f['event_name']} - {f['error']}")
    elif args.cmd == 'train':
        res = ml_model.train_model()
        print('Training results:', res)
    elif args.cmd == 'agent':
        try:
            out = agent_engine.run_agent_query(args.prompt)
        except RuntimeError as exc:
            raise SystemExit(str(exc))
        print(out['answer'])
    else:
        parser.print_help()


if __name__ == '__main__':
    cli()
